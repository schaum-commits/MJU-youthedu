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
  AlertCircle,
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Lightbulb,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  getGoogleScholarSearchUrl,
  RESEARCH_SYNC_INTERVAL_DAYS,
  runResearchSync,
  toggleResearchAutoSync,
} from '../lib/researchSync';
import { isSyncActivelyRunning } from '../lib/youthPaperSync';
import {
  formatAdmissionTerm,
  LIMITS,
  PageTab,
  ResearchComment,
  ResearchSyncStatus,
  ResearchTrend,
  TrendCategory,
} from '../types/community';
import {
  formatKoreanDate,
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
  researchSyncStatus = null,
  onOpenApplicationModal,
  onNavigate,
}: {
  researchSyncStatus?: ResearchSyncStatus | null;
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

  // Admin KCI AI Sync UI State
  const [syncingMode, setSyncingMode] = useState<'initial_1y' | 'biweekly' | null>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

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

  const latestArchiveTimestamp = useMemo(() => {
    if (researchSyncStatus?.lastSyncedAt) return researchSyncStatus.lastSyncedAt;
    let latest: ResearchTrend['updatedAt'] | null = null;
    let maxMs = 0;
    for (const item of trends) {
      const ms = item.updatedAt?.toMillis?.() ?? item.createdAt?.toMillis?.() ?? 0;
      if (ms > maxMs) {
        maxMs = ms;
        latest = item.updatedAt || item.createdAt;
      }
    }
    return latest;
  }, [researchSyncStatus, trends]);

  const isSyncCurrentlyRunning =
    syncingMode !== null || isSyncActivelyRunning(researchSyncStatus);
  const autoEnabled = researchSyncStatus?.autoEnabled !== false;

  const syncStatusMeta = useMemo(() => {
    if (isSyncCurrentlyRunning) {
      return {
        label: '동기화 진행 중',
        toneClass: 'text-[#002968]',
        icon: <RefreshCw className="w-4 h-4 text-[#002968] animate-spin" />,
      };
    }
    if (researchSyncStatus?.lastSyncStatus === 'success') {
      return {
        label: '정상 동기화 완료',
        toneClass: 'text-emerald-800',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-700" />,
      };
    }
    if (researchSyncStatus?.lastSyncStatus === 'error') {
      return {
        label: '동기화 오류 확인 필요',
        toneClass: 'text-red-700',
        icon: <AlertCircle className="w-4 h-4 text-red-600" />,
      };
    }
    return {
      label: '초기 구글 학술검색 연동 대기',
      toneClass: 'text-amber-800',
      icon: <Clock className="w-4 h-4 text-amber-700" />,
    };
  }, [isSyncCurrentlyRunning, researchSyncStatus?.lastSyncStatus]);

  const handleManualResearchSync = async (mode: 'initial_1y' | 'biweekly') => {
    if (!authUser || isSyncCurrentlyRunning) return;
    setSyncFeedback(null);
    setSyncingMode(mode);
    try {
      const result = await runResearchSync({
        mode,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingTrends: trends,
        autoEnabled,
        currentStatus: researchSyncStatus,
      });
      setSyncFeedback({
        type: result.ok ? 'ok' : 'err',
        text: result.message,
      });
    } finally {
      setSyncingMode(null);
    }
  };

  const handleToggleAutoSync = async () => {
    if (!authUser || togglingAuto) return;
    setTogglingAuto(true);
    setSyncFeedback(null);
    try {
      await toggleResearchAutoSync({
        enabled: !autoEnabled,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        currentStatus: researchSyncStatus,
      });
      setSyncFeedback({
        type: 'ok',
        text: !autoEnabled
          ? `구글 학술검색 ${RESEARCH_SYNC_INTERVAL_DAYS}일 주기 자동 업데이트가 켜졌습니다.`
          : '구글 학술검색 자동 업데이트가 일시 중지되었습니다.',
      });
    } finally {
      setTogglingAuto(false);
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
            구글 학술검색(Google Scholar) 최신 논문 AI 자동 연동과 원우들의 연구 리뷰를 함께 축적합니다.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-stone-800">
              <Clock className="w-3.5 h-3.5 text-[#002968]" />
              최근 업데이트 일자:{' '}
              <span className="font-mono tabular-nums">
                {latestArchiveTimestamp ? formatKoreanDateTime(latestArchiveTimestamp) : '대기 중'}
              </span>
            </span>
            <span className="text-stone-300" aria-hidden="true">
              ·
            </span>
            <span>
              구글 학술검색 연동 ({autoEnabled ? `${RESEARCH_SYNC_INTERVAL_DAYS}일마다 자동 업데이트` : '자동 업데이트 일시 중지'})
            </span>
            {autoEnabled && researchSyncStatus?.nextSyncAt && (
              <>
                <span className="text-stone-300" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono tabular-nums text-stone-500">
                  다음 예정: {formatKoreanDate(researchSyncStatus.nextSyncAt)}
                </span>
              </>
            )}
          </div>
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

      {/* Admin-only Last Auto-Sync Status & Control Panel */}
      {isAdmin && (
        <section
          aria-label="관리자 구글 학술검색 AI 자동 동기화 상태"
          className="mb-6 rounded-xl border border-[#D5DFEE] bg-[#F4F7FB] p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white border border-[#D5DFEE] flex items-center justify-center shrink-0 text-[#002968]">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-stone-900">
                    관리자 구글 학술검색 AI 자동 동기화 상태
                  </h2>
                  <span className="text-stone-300" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${syncStatusMeta.toneClass}`}
                  >
                    {syncStatusMeta.icon}
                    {syncStatusMeta.label}
                  </span>
                </div>
                <p className="text-xs text-stone-600 mt-0.5">
                  최초 연동 시 최근 1년간 발표된 구글 학술검색 청소년지도학 논문을 수집하고, 이후{' '}
                  {RESEARCH_SYNC_INTERVAL_DAYS}일(2주) 주기로 신규 논문을 자동 업데이트합니다.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isSyncCurrentlyRunning}
                onClick={() => handleManualResearchSync('initial_1y')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingMode === 'initial_1y' ? 'animate-spin' : ''}`}
                />
                {syncingMode === 'initial_1y' ? '최근 1년 수집 중...' : '최근 1년 논문 동기화'}
              </button>
              <button
                type="button"
                disabled={isSyncCurrentlyRunning}
                onClick={() => handleManualResearchSync('biweekly')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-[#002968]" />
                {syncingMode === 'biweekly' ? '최신 논문 확인 중...' : '2주 최신 논문 업데이트'}
              </button>
              <button
                type="button"
                disabled={togglingAuto}
                onClick={handleToggleAutoSync}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  autoEnabled
                    ? 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                    : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
                }`}
              >
                {autoEnabled ? '2주 자동 동기화: 켜짐' : '2주 자동 동기화: 꺼짐'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-[#D5DFEE] bg-white px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500">마지막 자동 동기화 일시</p>
              <p className="text-xs sm:text-sm font-semibold text-stone-900 font-mono tabular-nums mt-0.5">
                {researchSyncStatus?.lastSyncedAt
                  ? formatKoreanDateTime(researchSyncStatus.lastSyncedAt)
                  : '기록 없음 (초기 동기화 필요)'}
              </p>
            </div>
            <div className="rounded-lg border border-[#D5DFEE] bg-white px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500">다음 자동 업데이트 예정</p>
              <p className="text-xs sm:text-sm font-semibold text-stone-900 font-mono tabular-nums mt-0.5">
                {!autoEnabled
                  ? '자동 동기화 일시 중지됨'
                  : researchSyncStatus?.nextSyncAt
                    ? `${formatKoreanDate(researchSyncStatus.nextSyncAt)} (2주 주기)`
                    : '최초 동기화 완료 후 자동 예약'}
              </p>
            </div>
            <div className="rounded-lg border border-[#D5DFEE] bg-white px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500">최근 반영 결과 · 아카이브</p>
              <p className="text-xs sm:text-sm font-semibold text-stone-900 tabular-nums mt-0.5">
                {researchSyncStatus
                  ? `신규 ${researchSyncStatus.lastSyncCount}편 반영 · 총 ${trends.length}편`
                  : `총 ${trends.length}편 등록됨`}
              </p>
            </div>
          </div>

          {(syncFeedback || researchSyncStatus?.lastSyncMessage) && (
            <div
              className={`rounded-lg border px-3.5 py-2 text-xs leading-relaxed ${
                syncFeedback?.type === 'err' || researchSyncStatus?.lastSyncStatus === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-white border-[#D5DFEE] text-stone-700'
              }`}
            >
              <span className="font-semibold mr-1.5">
                {researchSyncStatus?.windowLabel ? `[${researchSyncStatus.windowLabel}]` : '[동기화 로그]'}
              </span>
              {syncFeedback?.text || researchSyncStatus?.lastSyncMessage}
            </div>
          )}
        </section>
      )}

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

            <div className="mb-6 flex flex-wrap items-center gap-2">
              {selectedTrend.externalUrl &&
                !selectedTrend.externalUrl.includes('scholar.google.') && (
                  <a
                    href={selectedTrend.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#002968] bg-[#F4F7FB] border border-[#D5DFEE] hover:bg-[#EAEFF7] rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    원문 또는 학술 자료 페이지 열기
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              <a
                href={
                  selectedTrend.externalUrl?.includes('scholar.google.')
                    ? selectedTrend.externalUrl
                    : getGoogleScholarSearchUrl(selectedTrend.title)
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Search className="w-3.5 h-3.5 text-[#002968]" />
                구글 학술검색에서 보기
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

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
