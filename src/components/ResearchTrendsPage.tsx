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
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Bookmark,
  Check,
  Edit3,
  ExternalLink,
  Lightbulb,
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
  formatAdmissionTerm,
  LIMITS,
  PageTab,
  ResearchComment,
  ResearchTrend,
  TrendCategory,
} from '../types/community';
import {
  formatKoreanDateTime,
  MemberAccessGate,
  NotionCallout,
  NotionSidePeekDrawer,
} from './NotionPrimitives';

const TREND_CATEGORIES: ('전체' | TrendCategory)[] = [
  '전체',
  '청소년정책·제도',
  '상담·심리지원',
  '디지털·미디어',
  '진로·자립지원',
  '학술논문·방법론',
  '학회·공모전',
];

export function ResearchTrendsPage({
  onOpenApplicationModal,
  onNavigate,
}: {
  onOpenApplicationModal: () => void;
  onNavigate: (tab: PageTab) => void;
}) {
  const { authUser, profile, isAdmin, isApprovedMember } = useAuth();
  const [trends, setTrends] = useState<ResearchTrend[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<'전체' | TrendCategory>('전체');
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);
  const [search, setSearch] = useState('');

  // Create / Edit Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTrend, setEditingTrend] = useState<ResearchTrend | null>(null);
  const [title, setTitle] = useState('');
  const [trendCategory, setTrendCategory] = useState<TrendCategory>('청소년정책·제도');
  const [source, setSource] = useState('');
  const [publishedPeriod, setPublishedPeriod] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [keyTakeaway, setKeyTakeaway] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Side-Peek & Comments
  const [selectedTrendId, setSelectedTrendId] = useState<string | null>(null);
  const [comments, setComments] = useState<ResearchComment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [confirmDeleteTrendId, setConfirmDeleteTrendId] = useState<string | null>(null);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isApprovedMember || !authUser) {
      setTrends([]);
      setBookmarkedIds(new Set());
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubTrends = onSnapshot(
      query(collection(db, 'researchTrends'), orderBy('createdAt', 'desc')),
      (snap) => {
        setTrends(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ResearchTrend, 'id'>),
          }))
        );
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'researchTrends');
      }
    );

    const unsubBookmarks = onSnapshot(
      collection(db, 'users', authUser.uid, 'bookmarks'),
      (snap) => {
        setBookmarkedIds(new Set(snap.docs.map((d) => d.id)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${authUser.uid}/bookmarks`);
      }
    );

    return () => {
      unsubTrends();
      unsubBookmarks();
    };
  }, [isApprovedMember, authUser]);

  const selectedTrend = useMemo(
    () => trends.find((t) => t.id === selectedTrendId) || null,
    [trends, selectedTrendId]
  );

  useEffect(() => {
    if (!isApprovedMember || !selectedTrendId) {
      setComments([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'researchTrends', selectedTrendId, 'comments'),
        orderBy('createdAt', 'asc')
      ),
      (snap) => {
        setComments(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ResearchComment, 'id'>),
          }))
        );
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `researchTrends/${selectedTrendId}/comments`
        );
      }
    );
    return unsub;
  }, [isApprovedMember, selectedTrendId]);

  const filteredTrends = useMemo(() => {
    const sorted = [...trends].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
    });
    return sorted.filter((t) => {
      if (category !== '전체' && t.category !== category) return false;
      if (onlyBookmarked && !bookmarkedIds.has(t.id)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          t.title.toLowerCase().includes(q) ||
          t.source.toLowerCase().includes(q) ||
          t.summary.toLowerCase().includes(q) ||
          t.authorName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [trends, category, onlyBookmarked, bookmarkedIds, search]);

  if (!isApprovedMember) {
    return (
      <MemberAccessGate
        sectionTitle="연구 동향 공유 아카이브"
        description="청소년 정책 브리프, 최신 학술논문 요약, 연구방법론 노트 및 학회·공모전 정보는 승인된 원우회원만 열람하고 공유할 수 있습니다."
        onOpenApplicationModal={onOpenApplicationModal}
        onNavigate={onNavigate}
      />
    );
  }

  const openCreateModal = () => {
    setEditingTrend(null);
    setTitle('');
    setTrendCategory('청소년정책·제도');
    setSource('');
    setPublishedPeriod('2026.11');
    setExternalUrl('');
    setSummary('');
    setKeyTakeaway('');
    setIsPinned(false);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditModal = (trend: ResearchTrend) => {
    setEditingTrend(trend);
    setTitle(trend.title);
    setTrendCategory(trend.category);
    setSource(trend.source);
    setPublishedPeriod(trend.publishedPeriod);
    setExternalUrl(trend.externalUrl || '');
    setSummary(trend.summary);
    setKeyTakeaway(trend.keyTakeaway || '');
    setIsPinned(trend.isPinned);
    setFormError(null);
    setEditorOpen(true);
  };

  const handleSaveTrend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setFormError(null);

    if (
      title.trim().length < 2 ||
      source.trim().length < 1 ||
      publishedPeriod.trim().length < 1 ||
      summary.trim().length < 5
    ) {
      setFormError('제목, 출처, 발행연월, 핵심 요약을 모두 입력해 주세요 (요약 5자 이상).');
      return;
    }

    setSaving(true);
    try {
      const cleanUrl = externalUrl.trim().slice(0, LIMITS.trendUrl);
      const cleanTakeaway = keyTakeaway.trim().slice(0, LIMITS.keyTakeaway);
      if (editingTrend) {
        const path = `researchTrends/${editingTrend.id}`;
        try {
          const updateData: Record<string, unknown> = {
            title: title.trim().slice(0, LIMITS.trendTitle),
            category: trendCategory,
            source: source.trim().slice(0, LIMITS.source),
            publishedPeriod: publishedPeriod.trim().slice(0, LIMITS.publishedPeriod),
            externalUrl: cleanUrl,
            summary: summary.trim().slice(0, LIMITS.trendSummary),
            keyTakeaway: cleanTakeaway,
            updatedAt: serverTimestamp(),
          };
          if (isAdmin) {
            updateData.isPinned = isPinned;
          }
          await updateDoc(doc(db, 'researchTrends', editingTrend.id), updateData);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        try {
          const docRef = await addDoc(collection(db, 'researchTrends'), {
            title: title.trim().slice(0, LIMITS.trendTitle),
            category: trendCategory,
            source: source.trim().slice(0, LIMITS.source),
            publishedPeriod: publishedPeriod.trim().slice(0, LIMITS.publishedPeriod),
            ...(cleanUrl ? { externalUrl: cleanUrl } : {}),
            summary: summary.trim().slice(0, LIMITS.trendSummary),
            ...(cleanTakeaway ? { keyTakeaway: cleanTakeaway } : {}),
            isPinned: isAdmin ? isPinned : false,
            authorUid: authUser.uid,
            authorName: (profile?.displayName || authUser.displayName || '원우').slice(
              0,
              LIMITS.displayName
            ),
            authorCohort: formatAdmissionTerm(profile?.cohort || '원우회원').slice(0, LIMITS.cohort),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setSelectedTrendId(docRef.id);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'researchTrends');
        }
      }
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrend = async (trendId: string) => {
    try {
      await deleteDoc(doc(db, 'researchTrends', trendId));
      setConfirmDeleteTrendId(null);
      if (selectedTrendId === trendId) setSelectedTrendId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `researchTrends/${trendId}`);
    }
  };

  const toggleBookmark = async (trend: ResearchTrend, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!authUser) return;
    const bookmarkPath = `users/${authUser.uid}/bookmarks/${trend.id}`;
    const ref = doc(db, 'users', authUser.uid, 'bookmarks', trend.id);
    try {
      if (bookmarkedIds.has(trend.id)) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, {
          trendId: trend.id,
          title: trend.title.slice(0, LIMITS.trendTitle),
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, bookmarkPath);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser || !selectedTrendId || !commentInput.trim()) return;
    setCommentSubmitting(true);
    const path = `researchTrends/${selectedTrendId}/comments`;
    try {
      await addDoc(collection(db, 'researchTrends', selectedTrendId, 'comments'), {
        trendId: selectedTrendId,
        authorUid: authUser.uid,
        authorName: (profile?.displayName || authUser.displayName || '원우').slice(
          0,
          LIMITS.displayName
        ),
        authorCohort: formatAdmissionTerm(profile?.cohort || '원우회원').slice(0, LIMITS.cohort),
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
    if (!selectedTrendId || !editingCommentText.trim()) return;
    const path = `researchTrends/${selectedTrendId}/comments/${commentId}`;
    try {
      await updateDoc(doc(db, 'researchTrends', selectedTrendId, 'comments', commentId), {
        content: editingCommentText.trim().slice(0, LIMITS.commentContent),
      });
      setEditingCommentId(null);
      setEditingCommentText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedTrendId) return;
    const path = `researchTrends/${selectedTrendId}/comments/${commentId}`;
    try {
      await deleteDoc(doc(db, 'researchTrends', selectedTrendId, 'comments', commentId));
      setConfirmDeleteCommentId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-6">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">학술 연구 아카이브</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            청소년지도학 연구 동향 공유
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            최신 정책 보고서, 학술논문 리뷰, 연구방법론 및 학회 소식을 원우들과 함께 축적합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          연구 동향 공유하기
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto max-w-full">
            {TREND_CATEGORIES.map((cat) => (
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

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setOnlyBookmarked((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                onlyBookmarked
                  ? 'bg-[#002968] text-white border-[#002968]'
                  : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              저장한 자료 ({bookmarkedIds.size})
            </button>
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="논문, 기관, 키워드 검색"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Trends List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-stone-200 p-5 animate-pulse space-y-3">
              <div className="h-3 w-36 bg-stone-200 rounded" />
              <div className="h-5 w-4/5 bg-stone-200 rounded" />
              <div className="h-10 w-full bg-stone-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredTrends.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-10 text-center space-y-3">
          <p className="text-sm text-stone-600">조건에 맞는 연구 동향 자료가 없습니다.</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md cursor-pointer"
          >
            새 연구 자료 공유하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTrends.map((trend) => {
            const isBookmarked = bookmarkedIds.has(trend.id);
            return (
              <article
                key={trend.id}
                onClick={() => {
                  setSelectedTrendId(trend.id);
                  setConfirmDeleteTrendId(null);
                }}
                className="group rounded-lg border border-stone-200 bg-white hover:border-stone-300 p-5 transition-colors cursor-pointer flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    {trend.isPinned && (
                      <span className="inline-flex items-center gap-1 text-[#002968] font-semibold">
                        <Pin className="w-3 h-3" />
                        추천
                      </span>
                    )}
                    {trend.isPinned && <span aria-hidden="true">·</span>}
                    <span>{trend.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{trend.publishedPeriod}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => toggleBookmark(trend, e)}
                    className={`p-1 rounded hover:bg-stone-100 transition-colors cursor-pointer ${
                      isBookmarked ? 'text-[#002968]' : 'text-stone-400'
                    }`}
                    aria-label={isBookmarked ? '북마크 해제' : '북마크 저장'}
                  >
                    <Bookmark className={`w-4 h-4 ${isBookmarked ? 'fill-current' : ''}`} />
                  </button>
                </div>

                <h2 className="text-base font-bold text-stone-900 leading-snug mb-1.5 group-hover:text-[#002968] line-clamp-2">
                  {trend.title}
                </h2>
                <p className="text-xs font-medium text-stone-500 mb-3">{trend.source}</p>
                <p className="text-xs sm:text-sm text-stone-600 leading-relaxed line-clamp-3 mb-4">
                  {trend.summary}
                </p>

                <div className="mt-auto pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
                  <span>
                    공유: {trend.authorName} ({formatAdmissionTerm(trend.authorCohort)})
                  </span>
                  {trend.externalUrl && (
                    <span className="inline-flex items-center gap-1 text-[#002968] font-medium">
                      원문 링크 <ExternalLink className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
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
                {editingTrend ? '연구 동향 수정' : '새 연구 동향 공유'}
              </h2>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTrend} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  논문 / 보고서 / 동향 제목 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.trendTitle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 청소년 디지털 리터러시 정책 방향 연구"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">분류</label>
                  <select
                    value={trendCategory}
                    onChange={(e) => setTrendCategory(e.target.value as TrendCategory)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                  >
                    {TREND_CATEGORIES.filter((c) => c !== '전체').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    출처 / 학술지 / 기관 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.source}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="예: 한국청소년연구"
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    발행연월 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.publishedPeriod}
                    value={publishedPeriod}
                    onChange={(e) => setPublishedPeriod(e.target.value)}
                    placeholder="2026.11"
                    className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  원문 또는 참고 URL (선택)
                </label>
                <input
                  type="url"
                  maxLength={LIMITS.trendUrl}
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  연구 내용 요약 <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  rows={6}
                  maxLength={LIMITS.trendSummary}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="연구 목적, 방법론, 주요 결과를 원우들이 읽기 쉽게 정리해 주세요."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  원우 시사점 / 핵심 인사이트 (선택)
                </label>
                <textarea
                  rows={2}
                  maxLength={LIMITS.keyTakeaway}
                  value={keyTakeaway}
                  onChange={(e) => setKeyTakeaway(e.target.value)}
                  placeholder="후속 논문 주제 아이디어나 현장 적용 포인트를 한 줄로 정리해 보세요."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
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
                  추천 연구 자료로 상단 고정 (관리자 전용)
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
                  {saving ? '저장 중...' : editingTrend ? '수정 완료' : '자료 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Notion Side-Peek Detail & Discussion */}
      <NotionSidePeekDrawer
        open={Boolean(selectedTrend)}
        onClose={() => {
          setSelectedTrendId(null);
          setConfirmDeleteTrendId(null);
        }}
        breadcrumb={`연구 동향 아카이브 / ${selectedTrend?.category || ''}`}
        headerActions={
          selectedTrend && (
            <>
              <button
                type="button"
                onClick={() => toggleBookmark(selectedTrend)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
                  bookmarkedIds.has(selectedTrend.id)
                    ? 'bg-[#002968] text-white border-[#002968]'
                    : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                {bookmarkedIds.has(selectedTrend.id) ? '저장됨' : '저장'}
              </button>
              {(isAdmin || selectedTrend.authorUid === authUser?.uid) && (
                <>
                  <button
                    type="button"
                    onClick={() => openEditModal(selectedTrend)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    수정
                  </button>
                  {confirmDeleteTrendId === selectedTrend.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteTrend(selectedTrend.id)}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                      >
                        삭제 확인
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteTrendId(null)}
                        className="px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 rounded-md cursor-pointer"
                      >
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTrendId(selectedTrend.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      삭제
                    </button>
                  )}
                </>
              )}
            </>
          )
        }
      >
        {selectedTrend && (
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-2">
              <span>{selectedTrend.category}</span>
              <span aria-hidden="true">·</span>
              <span>{selectedTrend.source}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{selectedTrend.publishedPeriod}</span>
            </div>

            <h2 className="font-serif text-2xl font-bold text-stone-900 leading-snug mb-3">
              {selectedTrend.title}
            </h2>

            <p className="text-xs text-stone-500 mb-5">
              공유자: {selectedTrend.authorName} ({formatAdmissionTerm(selectedTrend.authorCohort)}) ·{' '}
              <span className="font-mono tabular-nums">
                {formatKoreanDateTime(selectedTrend.createdAt)}
              </span>
            </p>

            {selectedTrend.externalUrl && (
              <div className="mb-6">
                <a
                  href={selectedTrend.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#002968] bg-[#F4F7FB] border border-[#D5DFEE] hover:bg-[#EAEFF7] rounded-md transition-colors"
                >
                  원문 또는 학술 자료 페이지 열기
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {selectedTrend.keyTakeaway && (
              <div className="mb-6">
                <NotionCallout icon={<Lightbulb className="w-4 h-4" />} title="핵심 시사점" tone="navy">
                  {selectedTrend.keyTakeaway}
                </NotionCallout>
              </div>
            )}

            <div className="text-sm sm:text-[15px] text-stone-800 leading-relaxed whitespace-pre-line pb-8 border-b border-stone-200">
              {selectedTrend.summary}
            </div>

            {/* Academic Discussion Comments */}
            <section className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-stone-500" />
                <h3 className="text-sm font-bold text-stone-900">
                  원우 학술 코멘트{' '}
                  <span className="tabular-nums text-stone-500">{comments.length}</span>
                </h3>
              </div>

              <div className="space-y-3 mb-5">
                {comments.length === 0 ? (
                  <p className="text-xs text-stone-500 py-2">
                    이 연구 자료에 대한 의견이나 연관 논문을 댓글로 공유해 보세요.
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
                            <span>{formatAdmissionTerm(c.authorCohort)}</span>
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
                  placeholder="후속 연구 아이디어나 질문 코멘트를 작성하세요."
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={commentSubmitting || !commentInput.trim()}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-50 rounded-md cursor-pointer"
                  >
                    {commentSubmitting ? '등록 중...' : '코멘트 등록'}
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
