'use client';

import { useSession } from '@repo/auth/react';
import { type CommentRoot } from '@repo/db/types';
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/avatar';
import { Button } from '@repo/ui/components/button';
import { Markdown } from '@repo/ui/components/markdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { toast } from '@repo/ui/components/use-toast';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Flag,
  MoreHorizontal,
  Pencil,
  Reply,
  Share,
  Trash2,
} from '@repo/ui/icons';
import clsx from 'clsx';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ReportDialog } from '~/components/report-dialog';
import { isAdminOrModerator } from '~/utils/auth-guards';
import { DefaultAvatar } from '~/utils/default-avatar';
import { getRelativeTimeStrict } from '~/utils/relativeTime';
import type { SolutionRouteData } from '../../solutions/[solutionId]/getSolutionIdRouteData';
import type { Challenge } from '../types';
import { Vote } from '../vote';
import { CommentInput } from './comment-input';
import { CommentSkeleton } from './comment-skeleton';
import { useCommentsReplies } from './comments.hooks';
import { CommentDeleteDialog } from './delete';
import { UserBadge } from './enhanced-user-badge';
import { type PaginatedComments, type PreselectedCommentMetadata } from './getCommentRouteData';

interface SingleCommentProps {
  comment: PaginatedComments['comments'][number];
  readonly?: boolean;
  isReply?: boolean;
  isToggleReply?: boolean;
  onClickReply?: () => void;
  onClickToggleReply?: () => void;
  preselectedCommentMetadata?: PreselectedCommentMetadata;
  deleteComment: (commentId: number) => Promise<void>;
  updateComment: (text: string, commentId: number) => Promise<void>;
}

type CommentProps = SingleCommentProps & {
  preselectedCommentMetadata?: PreselectedCommentMetadata;
  root: Challenge | SolutionRouteData;
  type: CommentRoot;
  deleteComment: (commentId: number) => Promise<void>;
  updateComment: (text: string, commentId: number) => Promise<void>;
};

const commentReportSchema = z
  .object({
    spam: z.boolean().optional(),
    threat: z.boolean().optional(),
    hate_speech: z.boolean().optional(),
    bullying: z.boolean().optional(),
    text: z.string().optional(),
  })
  .refine(
    (obj) => {
      const { spam, threat, hate_speech, bullying, text } = obj;
      return spam || threat || hate_speech || bullying || (text !== undefined && text !== '');
    },
    {
      path: ['text'],
      message: 'Your report should include an issue or a reason.',
    },
  );

export type CommentReportSchemaType = z.infer<typeof commentReportSchema>;

// million-ignore
export function Comment({
  comment,
  preselectedCommentMetadata,
  readonly = false,
  root,
  type,
  deleteComment,
  updateComment,
}: CommentProps) {
  const params = useSearchParams();
  const replyId = params.get('replyId');

  const hasPreselectedReply =
    preselectedCommentMetadata?.selectedComment?.id === comment.id && Boolean(replyId);

  const [showReplies, setShowReplies] = useState(hasPreselectedReply);
  const [isReplying, setIsReplying] = useState(false);

  const {
    status,
    data,
    fetchNextPage,
    addReplyComment,
    updateReplyComment,
    deleteReplyComment,
    showLoadMoreRepliesBtn,
    // @ts-ignore
  } = useCommentsReplies({
    enabled: showReplies,
    root,
    type,
    parentComment: comment,
    preselectedReplyId: hasPreselectedReply ? Number(replyId) : undefined,
  });

  const toggleReplies = () => setShowReplies(!showReplies);
  const toggleIsReplying = () => setIsReplying(!isReplying);

  return (
    <div className="flex flex-col px-2 py-1">
      <SingleComment
        preselectedCommentMetadata={preselectedCommentMetadata}
        comment={comment}
        isToggleReply={showReplies}
        onClickReply={toggleIsReplying}
        onClickToggleReply={toggleReplies}
        readonly={readonly}
        deleteComment={deleteComment}
        updateComment={updateComment}
      />
      {isReplying ? (
        <div className="relative mt-2 pb-2 pl-8">
          <Reply className="absolute left-2 top-2 h-4 w-4 opacity-50" />
          <CommentInput
            mode="edit"
            onCancel={() => {
              setIsReplying(false);
            }}
            onSubmit={async (text) => {
              await addReplyComment(text);
              setShowReplies(true);
              setIsReplying(false);
            }}
          />
        </div>
      ) : null}

      {showReplies && status === 'pending' ? <CommentSkeleton /> : null}
      {showReplies ? (
        <>
          <div className="flex flex-col gap-1 pl-6 pt-1">
            {data?.pages.flatMap((page) =>
              page.replies.map((reply) => (
                // this is a reply
                <SingleComment
                  comment={reply}
                  isReply
                  key={reply.id}
                  preselectedCommentMetadata={preselectedCommentMetadata}
                  deleteComment={deleteReplyComment}
                  updateComment={updateReplyComment}
                />
              )),
            )}
          </div>
          {showLoadMoreRepliesBtn ? (
            <Button
              variant="ghost"
              className="gap-1 text-xs text-neutral-500 duration-200 hover:text-neutral-400 dark:text-neutral-400 dark:hover:text-neutral-300"
              onClick={() => fetchNextPage()}
            >
              <MoreHorizontal size={24} />
              Load More
              <span className="sr-only">Load More</span>
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const SELECTED_CLASSES = 'rounded-md bg-sky-300/20';

// million-ignore
function SingleComment({
  comment,
  isReply,
  isToggleReply,
  onClickReply,
  onClickToggleReply,
  readonly = false,
  preselectedCommentMetadata,
  deleteComment,
  updateComment,
}: SingleCommentProps) {
  const { year, day } = useParams();
  const searchParams = useSearchParams();
  const replyId = searchParams.get('replyId');
  const [isEditing, setIsEditing] = useState(false);
  const elRef = useRef<HTMLDivElement | null>(null);
  const session = useSession();

  const isHighlighted = replyId
    ? Number(replyId) === comment.id
    : preselectedCommentMetadata?.selectedComment?.id === comment.id;

  async function copyPathNotifyUser(isReply: boolean) {
    try {
      await copyCommentUrlToClipboard(isReply);
      toast({
        title: 'Success!',
        variant: 'success',
        description: <p>Copied comment URL to clipboard!</p>,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failure!',
        variant: 'destructive',
        description: <p>Something went wrong!</p>,
      });
    }
  }

  async function copyCommentUrlToClipboard(isReply: boolean) {
    const commentId = isReply ? comment.parentId : comment.id;
    const paramsObj = { replyId: String(comment.id) };
    const searchParams = new URLSearchParams(paramsObj);

    const { rootType, rootSolutionId } = comment;
    const baseURL = `${window.location.origin}/events/${year}/${day}`;
    const hasGetParams = isReply ? `?${searchParams.toString()}` : '';

    const shareUrl =
      rootType === 'CHALLENGE'
        ? `${baseURL}/comments/${commentId}${hasGetParams}`
        : `${baseURL}/solutions/${rootSolutionId}/comments/${commentId}${hasGetParams}`;

    await navigator.clipboard.writeText(shareUrl);
  }

  const loggedinUser = useSession();

  const isAuthor = loggedinUser.data?.user?.id === comment.user.id;
  const isAdminAndModerator = isAdminOrModerator(loggedinUser.data);

  const hasBeenEdited = comment.updatedAt.getTime() > comment.createdAt.getTime();

  useEffect(() => {
    if (!isHighlighted) return;
    const timeout = setTimeout(() => {
      elRef.current?.classList.remove(...SELECTED_CLASSES.split(' '));
    }, 5000);
    window.requestAnimationFrame(() => elRef.current?.scrollIntoView({ block: 'nearest' }));
    return () => {
      clearTimeout(timeout);
    };
  }, [isHighlighted]);

  return (
    <div
      id={`comment-${comment.id}`}
      className={clsx(
        'relative p-2 pl-3',
        isHighlighted && SELECTED_CLASSES,
        'transition-colors',
        'duration-150',
      )}
      ref={elRef}
    >
      <div className="flex items-start justify-between gap-4 pr-[0.4rem]">
        <div className="mb-2 flex w-full items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarImage alt="github profile picture" src={comment.user?.image ?? ''} />
              <AvatarFallback>
                <DefaultAvatar />
              </AvatarFallback>
            </Avatar>
            <UserBadge
              user={{
                name: comment.user?.name ?? '',
                image: comment.user?.image ?? '',
                bio: comment.user?.bio ?? '',
                roles: comment.user?.roles ?? [],
              }}
              hideLinks
            />
          </div>

          <Tooltip delayDuration={0.05}>
            <TooltipTrigger asChild>
              <div className="text-muted-foreground flex items-center gap-2 whitespace-nowrap text-xs">
                <Calendar className="h-4 w-4" />
                <span>{getRelativeTimeStrict(comment.createdAt)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent align="start" alignOffset={-55} className="rounded-xl">
              <span className="text-foreground text-xs">{comment.createdAt.toLocaleString()}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {!isEditing && (
        <div className="-mb-1">
          <ExpandableContent content={comment.text} />
          {hasBeenEdited ? (
            <div className="text-muted-foreground flex items-center gap-2 whitespace-nowrap text-xs">
              Last edited at{' '}
              {new Intl.DateTimeFormat(undefined, {
                timeStyle: 'short',
                dateStyle: 'short',
              }).format(comment.updatedAt)}
            </div>
          ) : null}
        </div>
      )}
      {isEditing ? (
        <div className="mb-2">
          <CommentInput
            mode="edit"
            defaultValue={comment.text}
            onCancel={() => {
              setIsEditing(false);
            }}
            onSubmit={async (text) => {
              await updateComment(text, comment.id);
              setIsEditing(false);
            }}
          />
        </div>
      ) : null}
      <div className="my-auto mt-3 flex items-center gap-2">
        {!readonly && (
          <>
            <Vote
              voteCount={comment._count.vote}
              initialHasVoted={comment.vote.length > 0}
              disabled={!session?.data?.user?.id || comment.userId === session?.data?.user?.id}
              rootType="COMMENT"
              rootId={comment.id}
              onVote={(didUpvote: boolean) => {
                comment.vote = didUpvote
                  ? [
                      {
                        userId: session?.data?.user?.id ?? '',
                      },
                    ]
                  : [];
                comment._count.vote += didUpvote ? 1 : -1;
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="xs"
                  className="gap-2"
                  onClick={() => {
                    copyPathNotifyUser(Boolean(isReply));
                  }}
                >
                  <Share className="h-3 w-3" />
                  <span className="sr-only">Share this comment</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Share</p>
              </TooltipContent>
            </Tooltip>
            {!isReply && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="xs" onClick={onClickReply}>
                    <Reply className="h-3 w-3" />
                    <span className="sr-only">Create a reply</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reply</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isAuthor ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="xs" onClick={() => setIsEditing(!isEditing)}>
                    <Pencil className="h-3 w-3" />
                    <span className="sr-only">Edit this comment</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Edit</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
            {isAuthor || isAdminAndModerator ? (
              <Tooltip>
                <CommentDeleteDialog asChild comment={comment} deleteComment={deleteComment}>
                  <TooltipTrigger asChild>
                    <Button variant="secondary" size="xs">
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">Delete this comment</span>
                    </Button>
                  </TooltipTrigger>
                </CommentDeleteDialog>
                <TooltipContent>
                  <p>Delete</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <ReportDialog triggerAsChild commentId={comment.id} reportType="COMMENT">
                  <TooltipTrigger asChild>
                    <Button variant="secondary" size="xs">
                      <Flag className="h-3 w-3" />
                      <span className="sr-only">Report this comment</span>
                    </Button>
                  </TooltipTrigger>
                </ReportDialog>
                <TooltipContent>
                  <p>Report</p>
                </TooltipContent>
              </Tooltip>
            )}
            {comment._count.replies > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="z-50 ml-auto gap-1"
                onClick={onClickToggleReply}
              >
                {isToggleReply ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}

                <div className="text-xs">
                  {comment._count.replies === 1 ? '1 reply' : `${comment._count.replies} replies`}
                </div>
                <span className="sr-only">Toggle replies view</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ExpandableContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(true);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      if ((contentWrapperRef.current?.clientHeight ?? 0) > 300) {
        setExpanded(false);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [content]);

  return (
    <div
      className={clsx(
        { 'h-full': expanded, 'max-h-[300px]': !expanded },
        'relative w-full overflow-hidden break-words pl-[1px] text-sm',
      )}
      ref={contentWrapperRef}
    >
      <Markdown>{content}</Markdown>
      {!expanded && (
        <div
          className="absolute top-0 flex h-full w-full cursor-pointer items-end bg-gradient-to-b from-transparent to-white dark:to-zinc-800"
          onClick={() => setExpanded(true)}
        >
          <div className="text-md text-label-1 dark:text-dark-label-1 flex w-full items-center justify-center hover:bg-transparent">
            Read more
          </div>
        </div>
      )}
    </div>
  );
}