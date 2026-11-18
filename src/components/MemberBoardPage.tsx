import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  Check,
  Edit3,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BoardCategory,
  BoardComment,
  BoardPost,
  LIMITS,
  PageTab,
  RecruitStatus,
} from '../types/community';
import {
  formatKoreanDate,
  formatKoreanDateTime,
  MemberAccessGate,
  NotionSidePeekDrawer,
} from './NotionPrimitives';

const BOARD_CATEGORIES: ('전체' | BoardCategory)[] = [
  '전체',
  '공지사항',
  '스터디 모집',
  '학사·논문 Q&A',
  '자유게시판',
];

export function MemberBoardPage({
  onOpenApplicationModal,
  onNavigate,
}: {
  onOpenApplicationModal: () => void;
  onNavigate: (tab: PageTab) => void;
}) {
  const { authUser, profile, isAdmin, isApprovedMember } = useAuth();
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'전체' | BoardCategory>('전체');
  const [search, setSearch] = useState('');

  // Create / Edit Modal State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BoardPost | null>(null);
  const [title, setTitle] = useState('');
  const [postCategory, setPostCategory] = useState<BoardCategory>('자유게시판');
  const [recruitStatus, setRecruitStatus] = useState<RecruitStatus>('해당없음');
  const [studySchedule, setStudySchedule] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Side-Peek Detail & Comments
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isApprovedMember) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'boardPosts'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BoardPost, 'id'>),
        }));
        setPosts(list);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'boardPosts');
      }
    );
    return unsub;
  }, [isApprovedMember]);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedPostId) || null,
    [posts, selectedPostId]
  );

  useEffect(() => {
    if (!isApprovedMember || !selectedPostId) {
      setComments([]);
      return;
    }

    const q = query(
      collection(db, 'boardPosts', selectedPostId, 'comments'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setComments(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<BoardComment, 'id'>),
          }))
        );
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `boardPosts/${selectedPostId}/comments`
        );
      }
    );
    return unsub;
  }, [isApprovedMember, selectedPostId]);

  const filteredPosts = useMemo(() => {
    const sorted = [...posts].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });

    return sorted.filter((p) => {
      if (category !== '전체' && p.category !== category) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.authorName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [posts, category, search]);

  if (!isApprovedMember) {
    return (
      <MemberAccessGate
        sectionTitle="회원 전용 게시판"
        description="원우회 공지사항, 비공개 스터디 모집, 학사 및 논문 Q&A는 승인된 명지대학교 대학원 청소년지도학과 원우회원에게만 공개됩니다."
        onOpenApplicationModal={onOpenApplicationModal}
        onNavigate={onNavigate}
      />
    );
  }

  const openCreateModal = () => {
    setEditingPost(null);
    setTitle('');
    setPostCategory('스터디 모집');
    setRecruitStatus('모집중');
    setStudySchedule('');
    setContent('');
    setIsPinned(false);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditModal = (post: BoardPost) => {
    setEditingPost(post);
    setTitle(post.title);
    setPostCategory(post.category);
    setRecruitStatus(post.recruitStatus);
    setStudySchedule(post.studySchedule || '');
    setContent(post.content);
    setIsPinned(post.isPinned);
    setFormError(null);
    setEditorOpen(true);
  };

  const handleSavePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setFormError(null);

    if (title.trim().length < 2 || content.trim().length < 2) {
      setFormError('제목과 본문을 최소 2자 이상 입력해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const cleanTitle = title.trim().slice(0, LIMITS.title);
      const cleanContent = content.trim().slice(0, LIMITS.boardContent);
      const cleanSchedule = studySchedule.trim().slice(0, LIMITS.studySchedule);
      const effectiveRecruitStatus =
        postCategory === '스터디 모집' ? recruitStatus : '해당없음';

      if (editingPost) {
        const path = `boardPosts/${editingPost.id}`;
        try {
          const updatePayload: Record<string, unknown> = {
            title: cleanTitle,
            category: postCategory,
            content: cleanContent,
            recruitStatus: effectiveRecruitStatus,
            studySchedule: cleanSchedule,
            updatedAt: serverTimestamp(),
          };
          if (isAdmin) {
            updatePayload.isPinned = isPinned;
          }
          await updateDoc(doc(db, 'boardPosts', editingPost.id), updatePayload);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        const authorName = (profile?.displayName || authUser.displayName || '원우').slice(
          0,
          LIMITS.displayName
        );
        const authorCohort = (profile?.cohort || '원우회원').slice(0, LIMITS.cohort);
        try {
          const docRef = await addDoc(collection(db, 'boardPosts'), {
            title: cleanTitle,
            category: postCategory,
            content: cleanContent,
            isPinned: isAdmin ? isPinned : false,
            recruitStatus: effectiveRecruitStatus,
            ...(cleanSchedule ? { studySchedule: cleanSchedule } : {}),
            authorUid: authUser.uid,
            authorName,
            authorCohort,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setSelectedPostId(docRef.id);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'boardPosts');
        }
      }
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await deleteDoc(doc(db, 'boardPosts', postId));
      setConfirmDeletePostId(null);
      if (selectedPostId === postId) {
        setSelectedPostId(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `boardPosts/${postId}`);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !selectedPostId || !commentInput.trim()) return;
    setCommentSubmitting(true);
    const path = `boardPosts/${selectedPostId}/comments`;
    try {
      await addDoc(collection(db, 'boardPosts', selectedPostId, 'comments'), {
        postId: selectedPostId,
        authorUid: authUser.uid,
        authorName: (profile?.displayName || authUser.displayName || '원우').slice(
          0,
          LIMITS.displayName
        ),
        authorCohort: (profile?.cohort || '원우회원').slice(0, LIMITS.cohort),
        content: commentInput.trim().slice(0, LIMITS.commentContent),
        createdAt: serverTimestamp(),
      });
      setCommentInput('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    if (!selectedPostId || !editingCommentText.trim()) return;
    const path = `boardPosts/${selectedPostId}/comments/${commentId}`;
    try {
      await updateDoc(doc(db, 'boardPosts', selectedPostId, 'comments', commentId), {
        content: editingCommentText.trim().slice(0, LIMITS.commentContent),
      });
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedPostId) return;
    const path = `boardPosts/${selectedPostId}/comments/${commentId}`;
    try {
      await deleteDoc(doc(db, 'boardPosts', selectedPostId, 'comments', commentId));
      setConfirmDeleteCommentId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-6">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">회원 전용 공간</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            원우회 회원 전용 게시판
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            원우회 공지사항, 비공개 스터디 모집, 학사·논문 Q&A를 원우들과 자유롭게 나누세요.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          새 게시글 작성
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto">
          {BOARD_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === cat
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목, 내용, 작성자 검색"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
          />
        </div>
      </div>

      {/* Notion Database List */}
      {loading ? (
        <div className="rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 animate-pulse space-y-2">
              <div className="h-3 w-32 bg-stone-200 rounded" />
              <div className="h-4 w-2/3 bg-stone-200 rounded" />
            </div>
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-10 text-center space-y-3">
          <p className="text-sm text-stone-600">등록된 게시글이 없습니다.</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md cursor-pointer"
          >
            첫 게시글 작성하기
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white divide-y divide-stone-100 overflow-hidden">
          {filteredPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => {
                setSelectedPostId(post.id);
                setConfirmDeletePostId(null);
              }}
              className={`w-full text-left px-4 sm:px-5 py-4 hover:bg-[#F7F6F3] transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                post.isPinned ? 'bg-[#F9FAFB]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500 mb-1">
                  {post.isPinned && (
                    <span className="inline-flex items-center gap-1 text-[#002968] font-semibold">
                      <Pin className="w-3 h-3" />
                      고정
                    </span>
                  )}
                  {post.isPinned && <span aria-hidden="true">·</span>}
                  <span>{post.category}</span>
                  {post.category === '스터디 모집' && post.recruitStatus !== '해당없음' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          post.recruitStatus === '모집중'
                            ? 'text-emerald-700 font-semibold'
                            : 'text-stone-500'
                        }
                      >
                        {post.recruitStatus}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {post.authorName} ({post.authorCohort})
                  </span>
                </div>
                <p className="text-sm sm:text-[15px] font-semibold text-stone-900 truncate">
                  {post.title}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-400 font-mono tabular-nums shrink-0">
                <span>{formatKoreanDate(post.createdAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Post Create/Edit Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-stone-900/35 backdrop-blur-[1px]"
            onClick={() => setEditorOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-2xl bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-[#F7F6F3]">
              <h2 className="text-base font-bold text-stone-900">
                {editingPost ? '게시글 수정' : '새 게시글 작성'}
              </h2>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePost} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    카테고리
                  </label>
                  <select
                    value={postCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value as BoardCategory;
                      setPostCategory(nextCat);
                      if (nextCat === '스터디 모집' && recruitStatus === '해당없음') {
                        setRecruitStatus('모집중');
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                  >
                    <option value="공지사항">공지사항</option>
                    <option value="스터디 모집">스터디 모집</option>
                    <option value="학사·논문 Q&A">학사·논문 Q&A</option>
                    <option value="자유게시판">자유게시판</option>
                  </select>
                </div>

                {postCategory === '스터디 모집' && (
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1">
                      모집 상태
                    </label>
                    <select
                      value={recruitStatus}
                      onChange={(e) => setRecruitStatus(e.target.value as RecruitStatus)}
                      className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                    >
                      <option value="모집중">모집중</option>
                      <option value="마감">마감</option>
                    </select>
                  </div>
                )}
              </div>

              {postCategory === '스터디 모집' && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    모임 일정 및 진행 방식 (선택)
                  </label>
                  <input
                    type="text"
                    maxLength={LIMITS.studySchedule}
                    value={studySchedule}
                    onChange={(e) => setStudySchedule(e.target.value)}
                    placeholder="예: 매주 목요일 20:00 · 온라인 Zoom"
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  제목 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="게시글 제목을 입력하세요"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  본문 내용 <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  rows={8}
                  maxLength={LIMITS.boardContent}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="원우들과 나눌 공지, 스터디 안내, 질문 내용을 작성하세요."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968] leading-relaxed"
                />
              </div>

              {isAdmin && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="rounded border-stone-300 text-[#002968]"
                  />
                  게시판 상단에 고정 (관리자 전용)
                </label>
              )}

              {formError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md cursor-pointer"
                >
                  {saving ? '저장 중...' : editingPost ? '수정 완료' : '게시글 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notion Side-Peek Post Viewer & Comments */}
      <NotionSidePeekDrawer
        open={Boolean(selectedPost)}
        onClose={() => {
          setSelectedPostId(null);
          setConfirmDeletePostId(null);
        }}
        breadcrumb={`회원 전용 게시판 / ${selectedPost?.category || ''}`}
        headerActions={
          selectedPost &&
          (isAdmin || selectedPost.authorUid === authUser?.uid) && (
            <>
              <button
                type="button"
                onClick={() => openEditModal(selectedPost)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                수정
              </button>
              {confirmDeletePostId === selectedPost.id ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDeletePost(selectedPost.id)}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                  >
                    삭제 확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeletePostId(null)}
                    className="px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded-md cursor-pointer"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeletePostId(selectedPost.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  삭제
                </button>
              )}
            </>
          )
        }
      >
        {selectedPost && (
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-2">
              <span>{selectedPost.category}</span>
              <span aria-hidden="true">·</span>
              <span>
                {selectedPost.authorName} ({selectedPost.authorCohort})
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatKoreanDateTime(selectedPost.createdAt)}
              </span>
            </div>

            <h2 className="font-serif text-2xl font-bold text-stone-900 leading-snug mb-5">
              {selectedPost.title}
            </h2>

            {selectedPost.category === '스터디 모집' && (
              <dl className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-6">
                <div>
                  <dt className="text-stone-500 mb-0.5">모집 상태</dt>
                  <dd className="font-semibold text-stone-900">{selectedPost.recruitStatus}</dd>
                </div>
                <div>
                  <dt className="text-stone-500 mb-0.5">진행 일정</dt>
                  <dd className="font-semibold text-stone-900">
                    {selectedPost.studySchedule || '협의 후 결정'}
                  </dd>
                </div>
              </dl>
            )}

            <div className="text-sm sm:text-[15px] text-stone-800 leading-relaxed whitespace-pre-line pb-8 border-b border-stone-200">
              {selectedPost.content}
            </div>

            {/* Comments Section */}
            <section className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-stone-500" />
                <h3 className="text-sm font-bold text-stone-900">
                  원우 댓글 <span className="tabular-nums text-stone-500">{comments.length}</span>
                </h3>
              </div>

              <div className="space-y-3 mb-5">
                {comments.length === 0 ? (
                  <p className="text-xs text-stone-500 py-2">
                    아직 댓글이 없습니다. 첫 번째 의견을 남겨보세요.
                  </p>
                ) : (
                  comments.map((c) => {
                    const canManage = isAdmin || c.authorUid === authUser?.uid;
                    const isEditingThis = editingCommentId === c.id;
                    return (
                      <div
                        key={c.id}
                        className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-3.5"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="text-xs text-stone-600">
                            <span className="font-semibold text-stone-900">{c.authorName}</span>
                            <span className="mx-1.5 text-stone-400">·</span>
                            <span>{c.authorCohort}</span>
                            <span className="mx-1.5 text-stone-400">·</span>
                            <span className="font-mono tabular-nums text-stone-500">
                              {formatKoreanDateTime(c.createdAt)}
                            </span>
                          </div>
                          {canManage && !isEditingThis && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(c.id);
                                  setEditingCommentText(c.content);
                                }}
                                className="text-[11px] text-stone-500 hover:text-stone-900 cursor-pointer"
                              >
                                수정
                              </button>
                              {confirmDeleteCommentId === c.id ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteComment(c.id)}
                                    className="text-[11px] font-semibold text-red-700 cursor-pointer"
                                  >
                                    확인
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCommentId(null)}
                                    className="text-[11px] text-stone-500 cursor-pointer"
                                  >
                                    취소
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCommentId(c.id)}
                                  className="text-[11px] text-red-600 hover:text-red-800 cursor-pointer"
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {isEditingThis ? (
                          <div className="space-y-2 mt-2">
                            <textarea
                              rows={2}
                              maxLength={LIMITS.commentContent}
                              value={editingCommentText}
                              onChange={(e) => setEditingCommentText(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingCommentId(null)}
                                className="px-2.5 py-1 text-[11px] text-stone-600 bg-white border border-stone-200 rounded cursor-pointer"
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveCommentEdit(c.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-white bg-[#002968] rounded cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                저장
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs sm:text-sm text-stone-800 whitespace-pre-line leading-relaxed">
                            {c.content}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleAddComment} className="space-y-2">
                <textarea
                  rows={2}
                  maxLength={LIMITS.commentContent}
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="원우들에게 따뜻한 댓글이나 스터디 참여 의사를 남겨주세요."
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={commentSubmitting || !commentInput.trim()}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-50 rounded-md cursor-pointer"
                  >
                    {commentSubmitting ? '등록 중...' : '댓글 등록'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </NotionSidePeekDrawer>
    </div>
  );
}
