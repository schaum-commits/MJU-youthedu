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
  writeBatch,
} from 'firebase/firestore';
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Edit3,
  Eye,
  EyeOff,
  FileBarChart2,
  FileText,
  Image as ImageIcon,
  LogIn,
  MessageCircle,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  RESEARCH_SYNC_INTERVAL_DAYS,
  runResearchSync,
  toggleResearchAutoSync,
} from '../lib/researchSync';
import {
  AcademicSourcesStatusResponse,
  collectAndAnalyzePapers,
  fetchAcademicSourcesStatus,
  generateMonthlyTrendReport,
  getKstScheduleContext,
  isSyncActivelyRunning,
  NanetSearchTestResult,
  retryFailedPapers,
  testNanetPaperSearch,
  togglePaperVisibility,
} from '../lib/youthPaperSync';
import { DEFAULT_PUBLIC_SETTINGS, seedInitialWorkspaceData } from '../lib/seedData';
import {
  ACTIVITY_PRESET_IMAGES,
  ActivityCategory,
  AdminRecord,
  BoardCategory,
  BoardComment,
  BoardPost,
  BOOTSTRAPPED_ADMIN_EMAIL,
  CommunityLinks,
  CouncilActivity,
  COVER_IMAGE_URL,
  formatAdmissionTerm,
  LIMITS,
  MemberPublic,
  MembershipStatus,
  MonthlyTrendReport,
  PaperRecord,
  PublicSettings,
  ResearchComment,
  ResearchSyncLog,
  ResearchSyncStatus,
  ResearchTrend,
  resolveKakaoChatUrl,
  TrendCategory,
  UserProfile,
  YOUTH_RESEARCH_CATEGORIES,
} from '../types/community';
import {
  formatKoreanDate,
  formatKoreanDateTime,
  ResilientImage,
  resolveAssetUrl,
} from './NotionPrimitives';

type AdminSubTab = 'members' | 'content' | 'moderation' | 'research' | 'kakao';

const STATUS_LABELS: Record<MembershipStatus, string> = {
  pending: '관리자 인증 대기',
  approved: '회원 인증 완료',
  suspended: '비활성화됨',
  rejected: '반려됨',
};

export function AdminConsolePage({
  publicSettings,
  activities,
  researchSyncStatus = null,
  papers = [],
  monthlyReports = [],
}: {
  publicSettings: PublicSettings | null;
  activities: CouncilActivity[];
  researchSyncStatus?: ResearchSyncStatus | null;
  papers?: PaperRecord[];
  monthlyReports?: MonthlyTrendReport[];
}) {
  const { authUser, profile, isAdmin, loginWithGoogle } = useAuth();
  const [subTab, setSubTab] = useState<AdminSubTab>('members');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [syncingKciMode, setSyncingKciMode] = useState<'initial_1y' | 'biweekly' | null>(null);
  const [togglingKciAuto, setTogglingKciAuto] = useState(false);

  // Youth Research Automation State
  const [syncLogs, setSyncLogs] = useState<ResearchSyncLog[]>([]);
  const [runningYouthLookback, setRunningYouthLookback] = useState<3 | 12 | null>(null);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [generatingMonthlyReport, setGeneratingMonthlyReport] = useState(false);
  const [confirmDeletePaperId, setConfirmDeletePaperId] = useState<string | null>(null);
  const [confirmDeleteReportId, setConfirmDeleteReportId] = useState<string | null>(null);
  const [sourcesStatus, setSourcesStatus] = useState<AcademicSourcesStatusResponse | null>(null);
  const [nanetQuery, setNanetQuery] = useState('청소년지도');
  const [nanetTesting, setNanetTesting] = useState(false);
  const [nanetTestResult, setNanetTestResult] = useState<NanetSearchTestResult | null>(null);

  // Members & Admins State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [membersPublic, setMembersPublic] = useState<Record<string, MemberPublic>>({});
  const [adminsMap, setAdminsMap] = useState<Record<string, AdminRecord>>({});
  const [memberFilter, setMemberFilter] = useState<'all' | MembershipStatus>('all');
  const [memberSearch, setMemberSearch] = useState('');
  const [editingRoleUid, setEditingRoleUid] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState('');

  // Public Content (Home & Department Intro & Cover Photo) State
  const [councilName, setCouncilName] = useState('');
  const [semesterLabel, setSemesterLabel] = useState('');
  const [welcomeHeadline, setWelcomeHeadline] = useState('');
  const [welcomeSummary, setWelcomeSummary] = useState('');
  const [executiveNotice, setExecutiveNotice] = useState('');
  const [departmentIntro, setDepartmentIntro] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState(COVER_IMAGE_URL);
  const [savingHome, setSavingHome] = useState(false);

  // Activity Editor State
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CouncilActivity | null>(null);
  const [actTitle, setActTitle] = useState('');
  const [actCategory, setActCategory] = useState<ActivityCategory>('학술·세미나');
  const [actDate, setActDate] = useState('');
  const [actLocation, setActLocation] = useState('');
  const [actSummary, setActSummary] = useState('');
  const [actContent, setActContent] = useState('');
  const [actImageUrl, setActImageUrl] = useState(ACTIVITY_PRESET_IMAGES[2].url);
  const [actPublished, setActPublished] = useState(true);
  const [savingActivity, setSavingActivity] = useState(false);
  const [confirmDeleteActivityId, setConfirmDeleteActivityId] = useState<string | null>(null);

  // Moderation State (Board Posts, Research Trends & Comments)
  const [boardPosts, setBoardPosts] = useState<BoardPost[]>([]);
  const [researchTrends, setResearchTrends] = useState<ResearchTrend[]>([]);
  const [modTargetType, setModTargetType] = useState<'board' | 'trend'>('board');
  const [editingBoardPost, setEditingBoardPost] = useState<BoardPost | null>(null);
  const [editingTrend, setEditingTrend] = useState<ResearchTrend | null>(null);
  const [modTitle, setModTitle] = useState('');
  const [modCategory, setModCategory] = useState<BoardCategory>('공지사항');
  const [modTrendCategory, setModTrendCategory] = useState<TrendCategory>('청소년정책·제도');
  const [modTrendSource, setModTrendSource] = useState('');
  const [modContent, setModContent] = useState('');
  const [inspectCommentsTarget, setInspectCommentsTarget] = useState<{
    type: 'board' | 'trend';
    id: string;
    title: string;
  } | null>(null);
  const [inspectedComments, setInspectedComments] = useState<
    Array<
      | { kind: 'board'; data: BoardComment }
      | { kind: 'trend'; data: ResearchComment }
    >
  >([]);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [confirmDeleteModId, setConfirmDeleteModId] = useState<string | null>(null);

  // KakaoTalk Settings State
  const [mainChatTitle, setMainChatTitle] = useState('');
  const [mainChatUrl, setMainChatUrl] = useState('');
  const [mainChatPasscode, setMainChatPasscode] = useState('');
  const [studyChatTitle, setStudyChatTitle] = useState('');
  const [studyChatUrl, setStudyChatUrl] = useState('');
  const [roomRules, setRoomRules] = useState('');
  const [savingKakao, setSavingKakao] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((curr) => (curr?.text === text ? null : curr));
    }, 3500);
  };

  useEffect(() => {
    if (!isAdmin || subTab !== 'research') return;
    void fetchAcademicSourcesStatus().then((res) => setSourcesStatus(res));
  }, [isAdmin, subTab]);

  useEffect(() => {
    if (!isAdmin) return;

    const unsubUsers = onSnapshot(
      query(collection(db, 'users'), orderBy('createdAt', 'desc')),
      (snap) => {
        setUsers(snap.docs.map((d) => d.data() as UserProfile));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'users')
    );

    const unsubMembers = onSnapshot(
      collection(db, 'membersPublic'),
      (snap) => {
        const map: Record<string, MemberPublic> = {};
        snap.docs.forEach((d) => {
          map[d.id] = d.data() as MemberPublic;
        });
        setMembersPublic(map);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'membersPublic')
    );

    const unsubAdmins = onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        const map: Record<string, AdminRecord> = {};
        snap.docs.forEach((d) => {
          map[d.id] = d.data() as AdminRecord;
        });
        setAdminsMap(map);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'admins')
    );

    const unsubBoard = onSnapshot(
      query(collection(db, 'boardPosts'), orderBy('createdAt', 'desc')),
      (snap) => {
        setBoardPosts(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<BoardPost, 'id'>),
          }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'boardPosts')
    );

    const unsubTrends = onSnapshot(
      query(collection(db, 'researchTrends'), orderBy('createdAt', 'desc')),
      (snap) => {
        setResearchTrends(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ResearchTrend, 'id'>),
          }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'researchTrends')
    );

    const unsubKakao = onSnapshot(
      doc(db, 'settings', 'communityLinks'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as CommunityLinks;
          setMainChatTitle(data.mainChatTitle || '');
          setMainChatUrl(resolveKakaoChatUrl(data.mainChatUrl));
          setMainChatPasscode(data.mainChatPasscode || '');
          setStudyChatTitle(data.studyChatTitle || '');
          setStudyChatUrl(data.studyChatUrl || '');
          setRoomRules(
            (data.roomRules || '').replace(
              /\[(?:기수|입학년도\/학기)\/과정\/이름\]/g,
              '[입학년도/과정/이름]'
            )
          );
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/communityLinks')
    );

    const unsubSyncLogs = onSnapshot(
      query(collection(db, 'syncLogs'), orderBy('createdAt', 'desc')),
      (snap) => {
        setSyncLogs(snap.docs.slice(0, 15).map((d) => d.data() as ResearchSyncLog));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'syncLogs')
    );

    return () => {
      unsubUsers();
      unsubMembers();
      unsubAdmins();
      unsubBoard();
      unsubTrends();
      unsubKakao();
      unsubSyncLogs();
    };
  }, [isAdmin]);

  useEffect(() => {
    const s = publicSettings || DEFAULT_PUBLIC_SETTINGS;
    setCouncilName(s.councilName);
    setSemesterLabel(s.semesterLabel);
    setWelcomeHeadline(s.welcomeHeadline);
    setWelcomeSummary(s.welcomeSummary);
    setExecutiveNotice(s.executiveNotice || '');
    setDepartmentIntro(s.departmentIntro || DEFAULT_PUBLIC_SETTINGS.departmentIntro);
    setCoverImageUrl(s.coverImageUrl || COVER_IMAGE_URL);
  }, [publicSettings]);

  useEffect(() => {
    if (!isAdmin || !inspectCommentsTarget) {
      setInspectedComments([]);
      return;
    }
    const parentCol =
      inspectCommentsTarget.type === 'board' ? 'boardPosts' : 'researchTrends';
    const path = `${parentCol}/${inspectCommentsTarget.id}/comments`;
    const unsub = onSnapshot(
      query(collection(db, parentCol, inspectCommentsTarget.id, 'comments'), orderBy('createdAt', 'asc')),
      (snap) => {
        setInspectedComments(
          snap.docs.map((d) =>
            inspectCommentsTarget.type === 'board'
              ? { kind: 'board', data: { id: d.id, ...(d.data() as Omit<BoardComment, 'id'>) } }
              : { kind: 'trend', data: { id: d.id, ...(d.data() as Omit<ResearchComment, 'id'>) } }
          )
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, path)
    );
    return unsub;
  }, [isAdmin, inspectCommentsTarget]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (memberFilter !== 'all' && u.status !== memberFilter) return false;
      if (memberSearch.trim()) {
        const q = memberSearch.trim().toLowerCase();
        return (
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.studentId.toLowerCase().includes(q) ||
          formatAdmissionTerm(u.cohort).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, memberFilter, memberSearch]);

  const counts = useMemo(() => {
    return {
      total: users.length,
      pending: users.filter((u) => u.status === 'pending').length,
      approved: users.filter((u) => u.status === 'approved').length,
      suspended: users.filter((u) => u.status === 'suspended').length,
    };
  }, [users]);

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-14 px-4">
        <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-6 sm:p-8 text-center">
          <div className="w-11 h-11 rounded-lg bg-white border border-stone-200 flex items-center justify-center mx-auto mb-4 text-[#002968]">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mb-2">원우회 웹페이지 관리자 콘솔</h1>
          {!authUser ? (
            <>
              <p className="text-sm text-stone-600 leading-relaxed mb-6">
                관리자 페이지는 승인된 원우회 운영진 전용 공간입니다. 관리자 Google 계정(
                <span className="font-mono text-stone-800">{BOOTSTRAPPED_ADMIN_EMAIL}</span> 또는
                지정 관리자)으로 로그인해 주세요.
              </p>
              <button
                type="button"
                onClick={loginWithGoogle}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-lg transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                Google 관리자 계정으로 로그인
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-stone-700 leading-relaxed">
                현재 로그인된 계정(<span className="font-semibold">{authUser.email}</span>)에는
                관리자 권한이 부여되어 있지 않습니다.
              </p>
              <p className="text-xs text-stone-500">
                최고 관리자({BOOTSTRAPPED_ADMIN_EMAIL})가 [회원 승인 · 계정 관리] 탭에서 정회원을
                관리자로 지정할 수 있습니다.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Member Actions
  const handleSetMemberStatus = async (user: UserProfile, nextStatus: MembershipStatus) => {
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', user.uid), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      const memberRef = doc(db, 'membersPublic', user.uid);
      if (nextStatus === 'approved') {
        const existingRole = membersPublic[user.uid]?.roleTitle || '원우회원';
        batch.set(memberRef, {
          uid: user.uid,
          displayName: user.displayName.slice(0, LIMITS.displayName),
          cohort: formatAdmissionTerm(user.cohort).slice(0, LIMITS.cohort),
          program: user.program,
          academicStatus: user.academicStatus,
          researchInterest: (user.researchInterest || '').slice(0, LIMITS.researchInterest),
          roleTitle: existingRole,
          updatedAt: serverTimestamp(),
        });
      } else {
        if (membersPublic[user.uid]) {
          batch.delete(memberRef);
        }
      }

      await batch.commit();
      showToast('ok', `${user.displayName}님의 상태가 '${STATUS_LABELS[nextStatus]}'(으)로 변경되었습니다.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleSaveRoleTitle = async (uid: string) => {
    if (!roleDraft.trim()) return;
    try {
      await updateDoc(doc(db, 'membersPublic', uid), {
        roleTitle: roleDraft.trim().slice(0, LIMITS.roleTitle),
        updatedAt: serverTimestamp(),
      });
      setEditingRoleUid(null);
      showToast('ok', '원우회 직책이 업데이트되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `membersPublic/${uid}`);
    }
  };

  const handleToggleAdmin = async (user: UserProfile) => {
    if (!authUser) return;
    if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) {
      showToast('err', '기본 최고 관리자 계정은 해제할 수 없습니다.');
      return;
    }
    const isCurrentlyAdmin = Boolean(adminsMap[user.uid]);
    try {
      if (isCurrentlyAdmin) {
        await deleteDoc(doc(db, 'admins', user.uid));
        showToast('ok', `${user.displayName}님의 관리자 권한이 해제되었습니다.`);
      } else {
        await setDoc(doc(db, 'admins', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName.slice(0, LIMITS.displayName),
          grantedBy: authUser.uid,
          createdAt: serverTimestamp(),
        });
        showToast('ok', `${user.displayName}님에게 관리자 권한이 부여되었습니다.`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `admins/${user.uid}`);
    }
  };

  // Public Settings Save
  const handleSavePublicContent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingHome(true);
    try {
      await setDoc(doc(db, 'settings', 'public'), {
        councilName: councilName.trim().slice(0, 100),
        semesterLabel: semesterLabel.trim().slice(0, 60),
        welcomeHeadline: welcomeHeadline.trim().slice(0, 140),
        welcomeSummary: welcomeSummary.trim().slice(0, 1200),
        executiveNotice: executiveNotice.trim().slice(0, 600),
        departmentIntro: departmentIntro.trim().slice(0, 2000),
        coverImageUrl: (coverImageUrl.trim() || COVER_IMAGE_URL).slice(0, 500),
        updatedAt: serverTimestamp(),
      });
      showToast('ok', '학과 소개 및 대표 사진 설정이 업데이트되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/public');
    } finally {
      setSavingHome(false);
    }
  };

  // Activities CMS
  const openCreateActivity = () => {
    setEditingActivity(null);
    setActTitle('');
    setActCategory('학술·세미나');
    setActDate('2026.12.12 (토) 14:00');
    setActLocation('명지대학교 인문캠퍼스');
    setActSummary('');
    setActContent('');
    setActImageUrl(ACTIVITY_PRESET_IMAGES[2].url);
    setActPublished(true);
    setActivityModalOpen(true);
  };

  const openEditActivity = (act: CouncilActivity) => {
    setEditingActivity(act);
    setActTitle(act.title);
    setActCategory(act.category);
    setActDate(act.eventDate);
    setActLocation(act.location);
    setActSummary(act.summary);
    setActContent(act.content);
    setActImageUrl(act.imageUrl || ACTIVITY_PRESET_IMAGES[2].url);
    setActPublished(act.isPublished);
    setActivityModalOpen(true);
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setSavingActivity(true);
    try {
      const payload = {
        title: actTitle.trim().slice(0, LIMITS.title),
        category: actCategory,
        eventDate: actDate.trim().slice(0, LIMITS.eventDate),
        location: actLocation.trim().slice(0, LIMITS.location),
        summary: actSummary.trim().slice(0, LIMITS.summary),
        content: actContent.trim().slice(0, LIMITS.activityContent),
        imageUrl: actImageUrl.trim().slice(0, LIMITS.url),
        isPublished: actPublished,
        updatedAt: serverTimestamp(),
      };
      if (editingActivity) {
        await updateDoc(doc(db, 'activities', editingActivity.id), payload);
        showToast('ok', '원우회 활동 정보가 수정되었습니다.');
      } else {
        await addDoc(collection(db, 'activities'), {
          ...payload,
          authorUid: authUser.uid,
          authorName: (profile?.displayName || authUser.displayName || '원우회 관리자').slice(
            0,
            LIMITS.displayName
          ),
          createdAt: serverTimestamp(),
        });
        showToast('ok', '새 원우회 활동이 등록되었습니다.');
      }
      setActivityModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'activities');
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'activities', id));
      setConfirmDeleteActivityId(null);
      showToast('ok', '활동 게시물이 삭제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `activities/${id}`);
    }
  };

  // Moderation Actions (Board Posts, Trends, Comments)
  const handleTogglePin = async (kind: 'board' | 'trend', id: string, currentPinned: boolean) => {
    const col = kind === 'board' ? 'boardPosts' : 'researchTrends';
    try {
      await updateDoc(doc(db, col, id), {
        isPinned: !currentPinned,
        updatedAt: serverTimestamp(),
      });
      showToast('ok', !currentPinned ? '상단 고정되었습니다.' : '상단 고정이 해제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${col}/${id}`);
    }
  };

  const handleSaveModBoardPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBoardPost) return;
    try {
      await updateDoc(doc(db, 'boardPosts', editingBoardPost.id), {
        title: modTitle.trim().slice(0, LIMITS.title),
        category: modCategory,
        content: modContent.trim().slice(0, LIMITS.boardContent),
        updatedAt: serverTimestamp(),
      });
      setEditingBoardPost(null);
      showToast('ok', '게시글이 수정되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `boardPosts/${editingBoardPost.id}`);
    }
  };

  const handleSaveModTrend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrend) return;
    try {
      await updateDoc(doc(db, 'researchTrends', editingTrend.id), {
        title: modTitle.trim().slice(0, LIMITS.trendTitle),
        category: modTrendCategory,
        source: modTrendSource.trim().slice(0, LIMITS.source),
        summary: modContent.trim().slice(0, LIMITS.trendSummary),
        updatedAt: serverTimestamp(),
      });
      setEditingTrend(null);
      showToast('ok', '연구 동향 게시물이 수정되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `researchTrends/${editingTrend.id}`);
    }
  };

  const handleDeleteModItem = async (kind: 'board' | 'trend', id: string) => {
    const col = kind === 'board' ? 'boardPosts' : 'researchTrends';
    try {
      await deleteDoc(doc(db, col, id));
      setConfirmDeleteModId(null);
      if (inspectCommentsTarget?.id === id) setInspectCommentsTarget(null);
      showToast('ok', '항목이 삭제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${col}/${id}`);
    }
  };

  const handleAdminSaveCommentEdit = async (commentId: string) => {
    if (!inspectCommentsTarget || !editingCommentText.trim()) return;
    const parentCol =
      inspectCommentsTarget.type === 'board' ? 'boardPosts' : 'researchTrends';
    const path = `${parentCol}/${inspectCommentsTarget.id}/comments/${commentId}`;
    try {
      await updateDoc(doc(db, parentCol, inspectCommentsTarget.id, 'comments', commentId), {
        content: editingCommentText.trim().slice(0, LIMITS.commentContent),
      });
      setEditingCommentId(null);
      setEditingCommentText('');
      showToast('ok', '댓글이 수정되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleAdminDeleteComment = async (commentId: string) => {
    if (!inspectCommentsTarget) return;
    const parentCol =
      inspectCommentsTarget.type === 'board' ? 'boardPosts' : 'researchTrends';
    const path = `${parentCol}/${inspectCommentsTarget.id}/comments/${commentId}`;
    try {
      await deleteDoc(doc(db, parentCol, inspectCommentsTarget.id, 'comments', commentId));
      showToast('ok', '댓글이 삭제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // KakaoTalk Settings Save
  const handleSaveKakaoLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKakao(true);
    try {
      await setDoc(doc(db, 'settings', 'communityLinks'), {
        mainChatTitle: mainChatTitle.trim().slice(0, 100),
        mainChatUrl: mainChatUrl.trim().slice(0, 400),
        mainChatPasscode: mainChatPasscode.trim().slice(0, 40),
        studyChatTitle: studyChatTitle.trim().slice(0, 100),
        studyChatUrl: studyChatUrl.trim().slice(0, 400),
        roomRules: roomRules.trim().slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
      showToast('ok', '카카오톡 오픈채팅 연결 설정이 저장되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/communityLinks');
    } finally {
      setSavingKakao(false);
    }
  };

  const handleSeedSamples = async () => {
    if (!authUser) return;
    setSeeding(true);
    try {
      const wrote = await seedInitialWorkspaceData(
        authUser.uid,
        profile?.displayName || authUser.displayName || '원우회 관리자'
      );
      showToast(
        'ok',
        wrote
          ? '초기 활동, 게시판, 연구 동향 샘플 데이터가 추가되었습니다.'
          : '이미 초기 데이터가 존재하여 중복 생성하지 않았습니다.'
      );
    } finally {
      setSeeding(false);
    }
  };

  const handleAdminResearchSync = async (mode: 'initial_1y' | 'biweekly') => {
    if (!authUser || syncingKciMode || isSyncActivelyRunning(researchSyncStatus)) return;
    setSyncingKciMode(mode);
    try {
      const result = await runResearchSync({
        mode,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingTrends: researchTrends,
        autoEnabled: researchSyncStatus?.autoEnabled ?? true,
        currentStatus: researchSyncStatus,
      });
      showToast(result.ok ? 'ok' : 'err', result.message);
    } finally {
      setSyncingKciMode(null);
    }
  };

  const handleAdminToggleResearchAuto = async () => {
    if (!authUser || togglingKciAuto) return;
    const nextEnabled = !(researchSyncStatus?.autoEnabled !== false);
    setTogglingKciAuto(true);
    try {
      await toggleResearchAutoSync({
        enabled: nextEnabled,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        currentStatus: researchSyncStatus,
      });
      showToast(
        'ok',
        nextEnabled
          ? '자동 논문 수집 스케줄이 활성화되었습니다.'
          : '자동 논문 수집 스케줄이 일시 중지되었습니다.'
      );
    } finally {
      setTogglingKciAuto(false);
    }
  };

  // Youth Research Trends Admin Actions
  const kstCtx = useMemo(() => getKstScheduleContext(), []);
  const pendingOrFailedPapers = useMemo(
    () => papers.filter((p) => p.analysisStatus === 'failed' || p.analysisStatus === 'pending'),
    [papers]
  );
  const pendingPapersCount = useMemo(
    () => papers.filter((p) => p.analysisStatus === 'pending').length,
    [papers]
  );
  const failedPapersCount = useMemo(
    () => papers.filter((p) => p.analysisStatus === 'failed').length,
    [papers]
  );
  const completedPapersCount = useMemo(
    () => papers.filter((p) => p.analysisStatus === 'completed').length,
    [papers]
  );
  const domesticPapersCount = useMemo(
    () => papers.filter((p) => p.region === 'domestic').length,
    [papers]
  );
  const monthlyNewPapersCount = useMemo(
    () =>
      papers.filter((p) => {
        if (p.createdAt && typeof p.createdAt.toDate === 'function') {
          return getKstScheduleContext(p.createdAt.toDate()).currentMonthKey === kstCtx.currentMonthKey;
        }
        return (p.publicationDate || '').startsWith(kstCtx.currentMonthKey);
      }).length,
    [papers, kstCtx.currentMonthKey]
  );

  const isYouthSyncActive =
    runningYouthLookback !== null || isSyncActivelyRunning(researchSyncStatus);

  const handleYouthManualCollect = async (lookbackMonths: 3 | 12) => {
    if (!authUser || isYouthSyncActive) return;
    setRunningYouthLookback(lookbackMonths);
    try {
      const res = await collectAndAnalyzePapers({
        triggerType: 'manual',
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingPapers: papers,
        autoEnabled: researchSyncStatus?.autoEnabled ?? true,
        currentStatus: researchSyncStatus,
        lookbackMonths,
        perCategoryLimit: lookbackMonths === 3 ? 4 : 3,
        generateReportToo: true,
      });
      showToast(res.ok ? 'ok' : 'err', res.message);
    } finally {
      setRunningYouthLookback(null);
    }
  };

  const handleRetryFailedAnalysis = async () => {
    if (!authUser || retryingFailed || pendingOrFailedPapers.length === 0) return;
    setRetryingFailed(true);
    try {
      const res = await retryFailedPapers({
        failedPapers: pendingOrFailedPapers,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
      });
      showToast(res.ok ? 'ok' : 'err', res.message);
    } finally {
      setRetryingFailed(false);
    }
  };

  const handleNanetSearchTest = async () => {
    if (nanetTesting) return;
    setNanetTesting(true);
    try {
      const res = await testNanetPaperSearch(nanetQuery, 1, 10);
      setNanetTestResult(res);
      showToast(res.ok ? 'ok' : 'err', res.message);
    } finally {
      setNanetTesting(false);
    }
  };

  const handleAdminGenerateMonthlyReport = async () => {
    if (!authUser || generatingMonthlyReport) return;
    setGeneratingMonthlyReport(true);
    try {
      const res = await generateMonthlyTrendReport({
        papers,
        newPapersCount: monthlyNewPapersCount,
        authUser,
        isPublished: true,
      });
      showToast(res.ok ? 'ok' : 'err', res.message);
    } finally {
      setGeneratingMonthlyReport(false);
    }
  };

  const handleTogglePaperPublish = async (paper: PaperRecord) => {
    try {
      await togglePaperVisibility(paper);
      showToast(
        'ok',
        !paper.isPublished ? '논문이 연구동향 페이지에 공개되었습니다.' : '논문이 비공개로 전환되었습니다.'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `papers/${paper.paperId}`);
    }
  };

  const handleDeletePaper = async (paperId: string) => {
    try {
      await deleteDoc(doc(db, 'papers', paperId));
      setConfirmDeletePaperId(null);
      showToast('ok', '논문 데이터가 삭제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `papers/${paperId}`);
    }
  };

  const handleToggleReportPublish = async (report: MonthlyTrendReport) => {
    try {
      await updateDoc(doc(db, 'monthlyReports', report.reportId), {
        isPublished: !report.isPublished,
        updatedAt: serverTimestamp(),
      });
      showToast(
        'ok',
        !report.isPublished ? '월간 보고서가 공개되었습니다.' : '월간 보고서가 비공개로 전환되었습니다.'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `monthlyReports/${report.reportId}`);
    }
  };

  const handleDeleteMonthlyReport = async (reportId: string) => {
    try {
      await deleteDoc(doc(db, 'monthlyReports', reportId));
      setConfirmDeleteReportId(null);
      showToast('ok', '월간 보고서가 삭제되었습니다.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `monthlyReports/${reportId}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-6">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">Admin Console</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            원우회 웹페이지 관리자 콘솔
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            전체 회원 승인·비활성화, 게시글 및 댓글 통합 관리, 학과·활동 소개 및 카카오톡 링크를 관리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSeedSamples}
          disabled={seeding}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Database className="w-3.5 h-3.5 text-[#002968]" />
          {seeding ? '채우는 중...' : '기본 샘플 데이터 채우기'}
        </button>
      </div>

      {feedback && (
        <div
          className={`mb-5 px-4 py-3 rounded-lg border text-xs font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Admin Tab Switcher */}
      <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto mb-8">
        <button
          type="button"
          onClick={() => setSubTab('members')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            subTab === 'members'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          회원 승인 · 계정 관리 ({counts.pending} 대기 / {counts.total})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('content')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            subTab === 'content'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          학과 소개 · 활동 관리
        </button>
        <button
          type="button"
          onClick={() => setSubTab('moderation')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            subTab === 'moderation'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          게시글 · 댓글 통합 관리
        </button>
        <button
          type="button"
          onClick={() => setSubTab('research')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            subTab === 'research'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          연구동향 AI 관리 ({papers.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('kakao')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            subTab === 'kakao'
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          카카오톡 채팅방 설정
        </button>
      </div>

      {/* TAB 1: MEMBER MANAGEMENT */}
      {subTab === 'members' && (
        <section className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
              <p className="text-xs text-stone-500">전체 가입 신청</p>
              <p className="text-2xl font-bold text-stone-900 tabular-nums mt-1">{counts.total}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
              <p className="text-xs text-stone-500">인증 대기 중</p>
              <p className="text-2xl font-bold text-amber-700 tabular-nums mt-1">
                {counts.pending}
              </p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
              <p className="text-xs text-stone-500">인증 완료 정회원</p>
              <p className="text-2xl font-bold text-[#002968] tabular-nums mt-1">
                {counts.approved}
              </p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
              <p className="text-xs text-stone-500">비활성화 계정</p>
              <p className="text-2xl font-bold text-stone-700 tabular-nums mt-1">
                {counts.suspended}
              </p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto">
              {(
                [
                  { id: 'all', label: '전체' },
                  { id: 'pending', label: '인증 대기' },
                  { id: 'approved', label: '인증 완료' },
                  { id: 'suspended', label: '비활성화' },
                  { id: 'rejected', label: '반려' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setMemberFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                    memberFilter === f.id
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-64">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="이름, 이메일, 학번, 입학년도/학기 검색"
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              />
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-stone-200 bg-[#F7F6F3] text-xs font-semibold text-stone-600">
                  <th className="py-3 px-4">회원 정보</th>
                  <th className="py-3 px-4">학번 · 과정</th>
                  <th className="py-3 px-4">상태 · 권한</th>
                  <th className="py-3 px-4">원우회 직책</th>
                  <th className="py-3 px-4 text-right">계정 관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-xs">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-stone-500">
                      조회된 회원 계정이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const pub = membersPublic[u.uid];
                    const userIsAdmin =
                      u.email === BOOTSTRAPPED_ADMIN_EMAIL || Boolean(adminsMap[u.uid]);
                    return (
                      <tr key={u.uid} className="hover:bg-[#F7F6F3]/60">
                        <td className="py-3.5 px-4">
                          <p className="font-semibold text-stone-900 text-sm">{u.displayName}</p>
                          <p className="text-stone-500">{u.email}</p>
                          {u.applicationNote && (
                            <p className="text-[11px] text-stone-500 mt-1">
                              메모: {u.applicationNote}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-mono tabular-nums text-stone-800">{u.studentId}</p>
                          <p className="text-stone-500">
                            {formatAdmissionTerm(u.cohort)} · {u.program} ({u.academicStatus})
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <p
                            className={`font-semibold ${
                              u.status === 'approved'
                                ? 'text-emerald-700'
                                : u.status === 'pending'
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {STATUS_LABELS[u.status]}
                          </p>
                          <p className="text-[11px] text-stone-500 mt-0.5">
                            {userIsAdmin ? '웹 관리자' : '일반 회원'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          {u.status === 'approved' && pub ? (
                            editingRoleUid === u.uid ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  maxLength={LIMITS.roleTitle}
                                  value={roleDraft}
                                  onChange={(e) => setRoleDraft(e.target.value)}
                                  className="w-28 px-2 py-1 text-xs border border-stone-300 rounded"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveRoleTitle(u.uid)}
                                  className="p-1 text-white bg-[#002968] rounded cursor-pointer"
                                  aria-label="직책 저장"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingRoleUid(null)}
                                  className="p-1 text-stone-500 hover:bg-stone-100 rounded cursor-pointer"
                                  aria-label="취소"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRoleUid(u.uid);
                                  setRoleDraft(pub.roleTitle);
                                }}
                                className="inline-flex items-center gap-1 text-stone-700 hover:text-[#002968] cursor-pointer"
                              >
                                <span>{pub.roleTitle}</span>
                                <Edit3 className="w-3 h-3 text-stone-400" />
                              </button>
                            )
                          ) : (
                            <span className="text-stone-400">-</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                          {u.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleSetMemberStatus(u, 'approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded whitespace-nowrap cursor-pointer"
                            >
                              <UserCheck className="w-3 h-3" />
                              {u.status === 'pending' ? '회원 인증(승인)' : '재인증(승인)'}
                            </button>
                          )}
                          {u.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleSetMemberStatus(u, 'rejected')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer"
                            >
                              반려
                            </button>
                          )}
                          {u.status === 'approved' && u.email !== BOOTSTRAPPED_ADMIN_EMAIL && (
                            <button
                              type="button"
                              onClick={() => handleSetMemberStatus(u, 'suspended')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded cursor-pointer"
                            >
                              <UserX className="w-3 h-3" />
                              비활성화
                            </button>
                          )}
                          {u.status === 'approved' && u.email !== BOOTSTRAPPED_ADMIN_EMAIL && (
                            <button
                              type="button"
                              onClick={() => handleToggleAdmin(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded cursor-pointer"
                            >
                              <Shield className="w-3 h-3" />
                              {userIsAdmin ? '관리자 해제' : '관리자 지정'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 2: DEPARTMENT INTRO & ACTIVITIES CMS */}
      {subTab === 'content' && (
        <div className="space-y-10">
          {/* Home & Department Intro Form */}
          <section className="rounded-xl border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-bold text-stone-900 mb-1">학과 및 원우회 소개 콘텐츠 편집</h2>
            <p className="text-xs text-stone-500 mb-5">
              홈 화면에 노출되는 원우회 제목, 슬로건, 공지 배너 및 학과 소개 문구를 직접 수정합니다.
            </p>
            <form onSubmit={handleSavePublicContent} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    원우회 공식 명칭
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={councilName}
                    onChange={(e) => setCouncilName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    학기 · 캠퍼스 표기
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={semesterLabel}
                    onChange={(e) => setSemesterLabel(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  환영 헤드라인
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={welcomeHeadline}
                  onChange={(e) => setWelcomeHeadline(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  원우회 소개 요약
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={1200}
                  value={welcomeSummary}
                  onChange={(e) => setWelcomeSummary(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  학과 소개 본문 (01. 학과 및 원우회 소개 섹션)
                </label>
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={departmentIntro}
                  onChange={(e) => setDepartmentIntro(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  홈 상단 원우회 주요 공지 (Callout)
                </label>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={executiveNotice}
                  onChange={(e) => setExecutiveNotice(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>

              {/* Home Cover Photo Picker */}
              <div className="pt-4 border-t border-stone-200 space-y-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-[#002968]" />
                  <label className="text-xs font-semibold text-stone-900">
                    홈 상단 명지대 대표 커버 사진 변경
                  </label>
                </div>
                <div className="aspect-[16/5] w-full rounded-lg overflow-hidden border border-stone-200 bg-stone-100">
                  <ResilientImage
                    src={coverImageUrl || COVER_IMAGE_URL}
                    alt="홈 커버 미리보기"
                    className="w-full h-full object-cover"
                    fallbackTitle="대표 커버 미리보기"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {ACTIVITY_PRESET_IMAGES.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setCoverImageUrl(preset.url)}
                      className={`text-left rounded-md border overflow-hidden transition-colors cursor-pointer ${
                        resolveAssetUrl(coverImageUrl) === resolveAssetUrl(preset.url)
                          ? 'border-[#002968] ring-2 ring-[#002968]/20'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="aspect-[16/10] w-full bg-stone-100 overflow-hidden">
                        <img
                          src={resolveAssetUrl(preset.url)}
                          alt={preset.label}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="px-2 py-1 text-[11px] font-medium text-stone-700 truncate">
                        {preset.label}
                      </p>
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 mb-1">
                    또는 외부 이미지 URL 직접 입력
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={coverImageUrl}
                    onChange={(e) => setCoverImageUrl(e.target.value)}
                    placeholder="https://... 또는 ./src/assets/images/..."
                    className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingHome}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md cursor-pointer"
                >
                  {savingHome ? '저장 중...' : '홈 · 학과 소개 · 커버 사진 저장'}
                </button>
              </div>
            </form>
          </section>

          {/* Activities CMS */}
          <section className="rounded-xl border border-stone-200 bg-white p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-bold text-stone-900">원우회 활동 소개 관리</h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  새로운 원우회 활동, 세미나, 현장 탐방 일정을 등록하거나 수정·삭제합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateActivity}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                새 활동 추가
              </button>
            </div>

            <div className="divide-y divide-stone-100 border border-stone-200 rounded-lg overflow-hidden">
              {activities.length === 0 ? (
                <p className="p-6 text-center text-xs text-stone-500">등록된 활동이 없습니다.</p>
              ) : (
                activities.map((act) => (
                  <div
                    key={act.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F7F6F3]/60"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-stone-500 mb-0.5">
                        <span>{act.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{act.eventDate}</span>
                        <span aria-hidden="true">·</span>
                        <span className={act.isPublished ? 'text-emerald-700' : 'text-amber-700'}>
                          {act.isPublished ? '공개' : '비공개'}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-stone-900 truncate">{act.title}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditActivity(act)}
                        className="px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded cursor-pointer"
                      >
                        수정
                      </button>
                      {confirmDeleteActivityId === act.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDeleteActivity(act.id)}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 rounded cursor-pointer"
                          >
                            삭제 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteActivityId(null)}
                            className="px-2 py-1 text-xs text-stone-600 cursor-pointer"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteActivityId(act.id)}
                          className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: POSTS & COMMENTS MODERATION */}
      {subTab === 'moderation' && (
        <div className="space-y-6">
          {/* Google Scholar AI Auto-Sync Status Summary Card */}
          <div className="rounded-xl border border-[#D5DFEE] bg-[#F4F7FB] p-4 sm:p-5 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#D5DFEE] flex items-center justify-center shrink-0 text-[#002968]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-stone-900">
                      구글 학술검색 연구 동향 AI 자동 동기화 상태
                    </h2>
                    <span className="text-stone-300" aria-hidden="true">
                      ·
                    </span>
                    {syncingKciMode !== null || isSyncActivelyRunning(researchSyncStatus) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#002968]">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        동기화 진행 중
                      </span>
                    ) : researchSyncStatus?.lastSyncStatus === 'success' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                        정상 동기화 완료
                      </span>
                    ) : researchSyncStatus?.lastSyncStatus === 'error' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                        <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                        동기화 오류
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                        <Clock className="w-3.5 h-3.5 text-amber-700" />
                        초기 연동 대기
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 mt-0.5">
                    최근 업데이트:{' '}
                    <span className="font-mono tabular-nums font-medium text-stone-800">
                      {researchSyncStatus?.lastSyncedAt
                        ? formatKoreanDateTime(researchSyncStatus.lastSyncedAt)
                        : '미실행'}
                    </span>
                    <span className="mx-1.5 text-stone-300" aria-hidden="true">
                      ·
                    </span>
                    다음 예정:{' '}
                    <span className="font-mono tabular-nums font-medium text-stone-800">
                      {researchSyncStatus?.autoEnabled === false
                        ? '자동 동기화 중지됨'
                        : researchSyncStatus?.nextSyncAt
                          ? `${formatKoreanDate(researchSyncStatus.nextSyncAt)} (2주 주기)`
                          : '동기화 후 자동 예약'}
                    </span>
                    {researchSyncStatus?.lastSyncMessage && (
                      <>
                        <span className="mx-1.5 text-stone-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-stone-700">{researchSyncStatus.lastSyncMessage}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={
                    syncingKciMode !== null || isSyncActivelyRunning(researchSyncStatus)
                  }
                  onClick={() => handleAdminResearchSync('initial_1y')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${syncingKciMode === 'initial_1y' ? 'animate-spin' : ''}`}
                  />
                  최근 1년 논문 동기화
                </button>
                <button
                  type="button"
                  disabled={
                    syncingKciMode !== null || isSyncActivelyRunning(researchSyncStatus)
                  }
                  onClick={() => handleAdminResearchSync('biweekly')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  2주 최신 업데이트
                </button>
                <button
                  type="button"
                  disabled={togglingKciAuto}
                  onClick={handleAdminToggleResearchAuto}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {researchSyncStatus?.autoEnabled === false ? '자동 동기화: 꺼짐' : '자동 동기화: 켜짐'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => {
                setModTargetType('board');
                setInspectCommentsTarget(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                modTargetType === 'board'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              회원 게시판 ({boardPosts.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setModTargetType('trend');
                setInspectCommentsTarget(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                modTargetType === 'trend'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              연구 동향 ({researchTrends.length})
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Posts List */}
            <div className="lg:col-span-7 rounded-lg border border-stone-200 bg-white divide-y divide-stone-100 overflow-hidden">
              {(modTargetType === 'board' ? boardPosts : researchTrends).map((item) => {
                const isBoard = modTargetType === 'board';
                const boardItem = item as BoardPost;
                return (
                  <div key={item.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-0.5">
                          {item.isPinned && (
                            <span className="text-[#002968] font-semibold">고정</span>
                          )}
                          {item.isPinned && <span aria-hidden="true">·</span>}
                          <span>{item.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.authorName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatKoreanDate(item.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-stone-900">{item.title}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleTogglePin(modTargetType, item.id, item.isPinned)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded cursor-pointer"
                      >
                        <Pin className="w-3 h-3" />
                        {item.isPinned ? '고정 해제' : '상단 고정'}
                      </button>

                      {isBoard ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTrend(null);
                            setEditingBoardPost(boardItem);
                            setModTitle(boardItem.title);
                            setModCategory(boardItem.category);
                            setModContent(boardItem.content);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          수정
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const trendItem = item as ResearchTrend;
                            setEditingBoardPost(null);
                            setEditingTrend(trendItem);
                            setModTitle(trendItem.title);
                            setModTrendCategory(trendItem.category);
                            setModTrendSource(trendItem.source);
                            setModContent(trendItem.summary);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          수정
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setInspectCommentsTarget({
                            type: modTargetType,
                            id: item.id,
                            title: item.title,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#002968] bg-[#F4F7FB] hover:bg-[#EAEFF7] rounded cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        댓글 관리
                      </button>

                      {confirmDeleteModId === item.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteModItem(modTargetType, item.id)}
                            className="px-2 py-1 text-[11px] font-medium text-white bg-red-600 rounded cursor-pointer"
                          >
                            삭제 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteModId(null)}
                            className="px-2 py-1 text-[11px] text-stone-500 cursor-pointer"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteModId(item.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right Pane: Comments Inspector / Quick Post Edit */}
            <div className="lg:col-span-5 space-y-4">
              {editingBoardPost && (
                <div className="rounded-lg border border-stone-200 bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-stone-900">게시글 관리자 수정</h3>
                    <button
                      type="button"
                      onClick={() => setEditingBoardPost(null)}
                      className="text-stone-400 hover:text-stone-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <form onSubmit={handleSaveModBoardPost} className="space-y-3">
                    <select
                      value={modCategory}
                      onChange={(e) => setModCategory(e.target.value as BoardCategory)}
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md bg-white"
                    >
                      <option value="공지사항">공지사항</option>
                      <option value="스터디 모집">스터디 모집</option>
                      <option value="학사·논문 Q&A">학사·논문 Q&A</option>
                      <option value="자유게시판">자유게시판</option>
                    </select>
                    <input
                      type="text"
                      required
                      maxLength={LIMITS.title}
                      value={modTitle}
                      onChange={(e) => setModTitle(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md"
                    />
                    <textarea
                      rows={5}
                      required
                      maxLength={LIMITS.boardContent}
                      value={modContent}
                      onChange={(e) => setModContent(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingBoardPost(null)}
                        className="px-3 py-1.5 text-xs text-stone-600 border border-stone-200 rounded cursor-pointer"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#002968] rounded cursor-pointer"
                      >
                        수정 저장
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {editingTrend && (
                <div className="rounded-lg border border-stone-200 bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-stone-900">연구 동향 관리자 수정</h3>
                    <button
                      type="button"
                      onClick={() => setEditingTrend(null)}
                      className="text-stone-400 hover:text-stone-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <form onSubmit={handleSaveModTrend} className="space-y-3">
                    <select
                      value={modTrendCategory}
                      onChange={(e) => setModTrendCategory(e.target.value as TrendCategory)}
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md bg-white"
                    >
                      <option value="청소년정책·제도">청소년정책·제도</option>
                      <option value="상담·심리지원">상담·심리지원</option>
                      <option value="디지털·미디어">디지털·미디어</option>
                      <option value="진로·자립지원">진로·자립지원</option>
                      <option value="학술논문·방법론">학술논문·방법론</option>
                      <option value="학회·공모전">학회·공모전</option>
                    </select>
                    <input
                      type="text"
                      required
                      maxLength={LIMITS.trendTitle}
                      value={modTitle}
                      onChange={(e) => setModTitle(e.target.value)}
                      placeholder="제목"
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md"
                    />
                    <input
                      type="text"
                      required
                      maxLength={LIMITS.source}
                      value={modTrendSource}
                      onChange={(e) => setModTrendSource(e.target.value)}
                      placeholder="출처/기관"
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md"
                    />
                    <textarea
                      rows={5}
                      required
                      maxLength={LIMITS.trendSummary}
                      value={modContent}
                      onChange={(e) => setModContent(e.target.value)}
                      placeholder="요약"
                      className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-md"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingTrend(null)}
                        className="px-3 py-1.5 text-xs text-stone-600 border border-stone-200 rounded cursor-pointer"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#002968] rounded cursor-pointer"
                      >
                        수정 저장
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-5">
                <h3 className="text-sm font-bold text-stone-900 mb-1">댓글 관리 패널</h3>
                {!inspectCommentsTarget ? (
                  <p className="text-xs text-stone-600">
                    왼쪽 목록에서 게시물의 [댓글 관리] 버튼을 누르면 해당 게시물의 댓글을 수정·삭제할 수 있습니다.
                  </p>
                ) : (
                  <div className="space-y-3 mt-3">
                    <p className="text-xs font-medium text-[#002968] line-clamp-1">
                      대상: {inspectCommentsTarget.title}
                    </p>
                    {inspectedComments.length === 0 ? (
                      <p className="text-xs text-stone-500">등록된 댓글이 없습니다.</p>
                    ) : (
                      inspectedComments.map(({ data: c }) => (
                        <div key={c.id} className="rounded-md bg-white border border-stone-200 p-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-stone-900">
                              {c.authorName}{' '}
                              <span className="font-normal text-stone-500">
                                ({formatKoreanDateTime(c.createdAt)})
                              </span>
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(c.id);
                                  setEditingCommentText(c.content);
                                }}
                                className="text-[11px] text-stone-600 hover:text-stone-900 cursor-pointer"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdminDeleteComment(c.id)}
                                className="text-[11px] text-red-600 hover:text-red-800 cursor-pointer"
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                          {editingCommentId === c.id ? (
                            <div className="space-y-2 mt-2">
                              <textarea
                                rows={2}
                                maxLength={LIMITS.commentContent}
                                value={editingCommentText}
                                onChange={(e) => setEditingCommentText(e.target.value)}
                                className="w-full px-2 py-1 text-xs border border-stone-300 rounded"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingCommentId(null)}
                                  className="px-2 py-1 text-[11px] border border-stone-200 rounded cursor-pointer"
                                >
                                  취소
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdminSaveCommentEdit(c.id)}
                                  className="px-2 py-1 text-[11px] text-white bg-[#002968] rounded cursor-pointer"
                                >
                                  저장
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-stone-700 whitespace-pre-line">{c.content}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: YOUTH RESEARCH TRENDS AI COLLECTION & REPORTS */}
      {subTab === 'research' && (
        <section className="space-y-6">
          {/* Status & Schedule Control Card */}
          <div className="rounded-xl border border-[#D5DFEE] bg-[#F4F7FB] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-stone-900">
                    월간 논문 자동 수집 · Gemini AI 분석 현황
                  </h2>
                  <span className="text-stone-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs font-semibold text-[#002968]">
                    스케줄: {kstCtx.cron} ({kstCtx.timezone})
                  </span>
                </div>
                <p className="text-xs text-stone-600">
                  마지막 업데이트:{' '}
                  <span className="font-mono font-medium text-stone-800">
                    {researchSyncStatus?.lastSyncedAt
                      ? formatKoreanDateTime(researchSyncStatus.lastSyncedAt)
                      : '미실행'}
                  </span>
                  <span className="mx-1.5 text-stone-300" aria-hidden="true">
                    ·
                  </span>
                  다음 정기 실행:{' '}
                  <span className="font-mono font-medium text-stone-800">
                    {kstCtx.nextRunLabel}
                  </span>
                </p>
                {researchSyncStatus?.lastSyncMessage && (
                  <p className="text-xs text-stone-700">{researchSyncStatus.lastSyncMessage}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleYouthManualCollect(3)}
                  disabled={isYouthSyncActive}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${runningYouthLookback === 3 || isYouthSyncActive ? 'animate-spin' : ''}`}
                  />
                  {runningYouthLookback === 3 ? '3개월 수집 중...' : '최근 3개월 업데이트'}
                </button>
                <button
                  type="button"
                  onClick={() => handleYouthManualCollect(12)}
                  disabled={isYouthSyncActive}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${runningYouthLookback === 12 ? 'animate-spin' : ''}`}
                  />
                  {runningYouthLookback === 12 ? '12개월 수집 중...' : '최근 12개월 전체 수집'}
                </button>
                <button
                  type="button"
                  onClick={handleRetryFailedAnalysis}
                  disabled={retryingFailed || pendingOrFailedPapers.length === 0 || isYouthSyncActive}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
                  {retryingFailed
                    ? 'AI 분석 실행 중...'
                    : `대기·실패 논문 AI 분석 (${pendingOrFailedPapers.length}건)`}
                </button>
                <button
                  type="button"
                  onClick={handleAdminGenerateMonthlyReport}
                  disabled={generatingMonthlyReport || papers.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileBarChart2 className="w-3.5 h-3.5 text-[#002968]" />
                  {generatingMonthlyReport ? '보고서 생성 중...' : '월간 보고서 생성'}
                </button>
              </div>
            </div>

            {/* KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div className="rounded-lg bg-white border border-stone-200 p-3.5">
                <p className="text-[11px] text-stone-500">전체 수집 논문 (국내 · 해외)</p>
                <p className="text-lg font-bold text-stone-900 tabular-nums mt-0.5">
                  {papers.length}편{' '}
                  <span className="text-xs font-normal text-stone-500">
                    (국내 {domesticPapersCount} · 해외 {papers.length - domesticPapersCount})
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-white border border-stone-200 p-3.5">
                <p className="text-[11px] text-stone-500">이번 달 신규 수집</p>
                <p className="text-lg font-bold text-[#002968] tabular-nums mt-0.5">
                  {monthlyNewPapersCount}편
                </p>
              </div>
              <div className="rounded-lg bg-white border border-stone-200 p-3.5">
                <p className="text-[11px] text-stone-500">AI 분석 완료 / 대기 · 실패</p>
                <p className="text-base font-bold tabular-nums mt-0.5">
                  <span className="text-emerald-700">{completedPapersCount} 완료</span>
                  <span className="text-stone-300 mx-1">/</span>
                  <span className={pendingPapersCount > 0 ? 'text-amber-700' : 'text-stone-500'}>
                    {pendingPapersCount} 대기
                  </span>
                  <span className="text-stone-300 mx-1">/</span>
                  <span className={failedPapersCount > 0 ? 'text-red-700' : 'text-stone-500'}>
                    {failedPapersCount} 실패
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-white border border-stone-200 p-3.5">
                <p className="text-[11px] text-stone-500">최근 실행 API · 토큰 사용량</p>
                <p className="text-xs font-semibold text-stone-900 tabular-nums mt-1">
                  {syncLogs[0]
                    ? `OA ${syncLogs[0].openAlexCalls} · CR ${syncLogs[0].crossrefCalls} · AI ${syncLogs[0].geminiCalls} (${syncLogs[0].estimatedTokens.toLocaleString()} tok)`
                    : '실행 기록 대기 중'}
                </p>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {YOUTH_RESEARCH_CATEGORIES.map((cat) => {
                const count = papers.filter((p) => p.mainCategory === cat).length;
                return (
                  <div
                    key={cat}
                    className="rounded-md bg-white border border-stone-200 px-3 py-2 text-xs"
                  >
                    <p className="text-stone-500 truncate">{cat}</p>
                    <p className="font-bold text-stone-900 tabular-nums mt-0.5">{count}편</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Papers Visibility & Analysis Management Table */}
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-[#F7F6F3] flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900">
                수집 논문 공개·비공개 및 분석 상태 관리 ({papers.length}편)
              </h3>
              <span className="text-xs text-stone-500">
                공개 설정된 논문만 일반 방문자에게 노출됩니다
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[780px] text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-stone-600 font-semibold">
                    <th className="py-2.5 px-4">논문 제목 · 학술지</th>
                    <th className="py-2.5 px-3">대표 분야</th>
                    <th className="py-2.5 px-3">구분 · 발행일</th>
                    <th className="py-2.5 px-3">AI 분석</th>
                    <th className="py-2.5 px-3">공개 여부</th>
                    <th className="py-2.5 px-4 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {papers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-stone-500">
                        수집된 논문이 없습니다. [수동 업데이트 실행]을 눌러 첫 수집을 시작하세요.
                      </td>
                    </tr>
                  ) : (
                    papers.map((p) => (
                      <tr key={p.paperId} className="hover:bg-[#F7F6F3]/60">
                        <td className="py-3 px-4 max-w-md">
                          <p className="font-semibold text-stone-900 line-clamp-1">{p.title}</p>
                          <p className="text-[11px] text-stone-500 truncate">{p.journalName}</p>
                        </td>
                        <td className="py-3 px-3 text-stone-700 whitespace-nowrap">
                          {p.mainCategory}
                        </td>
                        <td className="py-3 px-3 text-stone-600 whitespace-nowrap tabular-nums">
                          {p.region === 'domestic' ? '국내' : '해외'} · {p.publicationDate}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {p.analysisStatus === 'completed' ? (
                            <span className="text-emerald-700 font-semibold">완료</span>
                          ) : p.analysisStatus === 'pending' ? (
                            <span
                              className="text-amber-700 font-semibold"
                              title={p.analysisError || 'AI 요약 대기 중'}
                            >
                              대기
                            </span>
                          ) : (
                            <span
                              className="text-red-700 font-semibold"
                              title={p.analysisError || '분석 실패'}
                            >
                              실패
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleTogglePaperPublish(p)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                              p.isPublished
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-stone-100 text-stone-600 border border-stone-200'
                            }`}
                          >
                            {p.isPublished ? (
                              <>
                                <Eye className="w-3 h-3" /> 공개중
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-3 h-3" /> 비공개
                              </>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {confirmDeletePaperId === p.paperId ? (
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeletePaper(p.paperId)}
                                className="px-2 py-1 text-[11px] text-white bg-red-600 rounded cursor-pointer"
                              >
                                삭제 확인
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePaperId(null)}
                                className="px-2 py-1 text-[11px] text-stone-500 cursor-pointer"
                              >
                                취소
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePaperId(p.paperId)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              삭제
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Trend Reports Management */}
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-[#F7F6F3] flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900">
                월간 연구동향 보고서 관리 ({monthlyReports.length}건)
              </h3>
            </div>
            <div className="divide-y divide-stone-100">
              {monthlyReports.length === 0 ? (
                <p className="p-6 text-center text-xs text-stone-500">
                  생성된 월간 연구동향 보고서가 없습니다.
                </p>
              ) : (
                monthlyReports.map((rep) => (
                  <div
                    key={rep.reportId}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-bold text-stone-900">
                        {rep.monthLabel} 청소년지도 연구동향 보고서
                      </p>
                      <p className="text-xs text-stone-500 tabular-nums mt-0.5">
                        {rep.periodRange} · 전체 {rep.totalPapersCount}편 (국내 {rep.domesticCount} /
                        해외 {rep.internationalCount})
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleReportPublish(rep)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
                          rep.isPublished
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-stone-100 text-stone-600 border border-stone-200'
                        }`}
                      >
                        {rep.isPublished ? '공개중' : '비공개'}
                      </button>
                      {confirmDeleteReportId === rep.reportId ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteMonthlyReport(rep.reportId)}
                            className="px-2 py-1 text-xs text-white bg-red-600 rounded cursor-pointer"
                          >
                            삭제 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteReportId(null)}
                            className="px-2 py-1 text-xs text-stone-500 cursor-pointer"
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteReportId(rep.reportId)}
                          className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded cursor-pointer"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Collection & Analysis Execution Logs */}
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-[#F7F6F3]">
              <h3 className="text-sm font-bold text-stone-900">
                자동 수집 · AI 분석 실행 및 오류 로그 (최근 {syncLogs.length}건)
              </h3>
            </div>
            <div className="divide-y divide-stone-100 text-xs">
              {syncLogs.length === 0 ? (
                <p className="p-6 text-center text-stone-500">아직 기록된 실행 로그가 없습니다.</p>
              ) : (
                syncLogs.map((log) => (
                  <div key={log.logId} className="p-4 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-semibold ${
                            log.status === 'success'
                              ? 'text-emerald-700'
                              : log.status === 'partial'
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {log.status === 'success'
                            ? '정상 완료'
                            : log.status === 'partial'
                              ? '부분 오류'
                              : '실행 오류'}
                        </span>
                        <span className="text-stone-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-stone-800">
                          {log.triggerType === 'scheduled_monthly'
                            ? '월간 정기 자동'
                            : log.triggerType === 'retry_failed'
                              ? '실패 논문 재분석'
                              : '수동 실행'}
                        </span>
                        <span className="text-stone-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-stone-600 tabular-nums">
                          신규 {log.newPapersCount}편 (국내 {log.domesticCount} · 해외{' '}
                          {log.internationalCount}) · AI 성공 {log.analyzedSuccessCount} / 실패{' '}
                          {log.analyzedFailedCount}
                        </span>
                      </div>
                      <span className="font-mono text-stone-500 tabular-nums">
                        {formatKoreanDateTime(log.createdAt)} · {log.executedByName}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500 tabular-nums">
                      API 호출: OpenAlex {log.openAlexCalls}회 · Crossref {log.crossrefCalls}회 ·
                      Gemini {log.geminiCalls}회 · 토큰 {log.estimatedTokens.toLocaleString()}
                    </p>
                    {(log.collectionErrors.length > 0 || log.analysisErrors.length > 0) && (
                      <div className="rounded bg-red-50 border border-red-100 p-2.5 text-[11px] text-red-800 space-y-0.5">
                        {log.collectionErrors.map((e, idx) => (
                          <p key={`ce_${idx}`}>[수집 오류] {e}</p>
                        ))}
                        {log.analysisErrors.map((e, idx) => (
                          <p key={`ae_${idx}`}>[분석 오류] {e}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Academic Sources Governance & Step 2 National Assembly Library Test */}
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-200 bg-[#F7F6F3] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-stone-900">
                  국내외 학술정보 API 연동 현황 · 2단계 국회도서관 검색 테스트
                </h3>
                <p className="text-xs text-stone-600 mt-0.5">
                  인증키가 없는 서비스는 임의 데이터를 생성하지 않고 연결 준비 상태로 표시합니다.
                  {sourcesStatus?.koreanKeywords?.totalCount
                    ? ` (국내 확장 검색어 ${sourcesStatus.koreanKeywords.totalCount}개 등록됨)`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchAcademicSourcesStatus().then((res) => setSourcesStatus(res))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                연동 상태 새로고침
              </button>
            </div>

            <div className="p-4 space-y-4">
              {sourcesStatus && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sourcesStatus.sources.map((src) => (
                    <div
                      key={src.id}
                      className="rounded-lg border border-stone-200 bg-[#FBFBFA] p-3.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-stone-900 truncate">
                          {src.name}
                        </span>
                        <span
                          className={`text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                            src.status === 'connected'
                              ? 'text-emerald-700'
                              : src.status === 'ready_needs_key'
                                ? 'text-amber-700'
                                : 'text-stone-500'
                          }`}
                        >
                          {src.status === 'connected'
                            ? '연결됨'
                            : src.status === 'ready_needs_key'
                              ? '연결 준비 (인증키 필요)'
                              : src.stepLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500">
                        {src.scope === 'domestic' ? '국내 우선' : '해외 보완'} ·{' '}
                        {src.envVar ? `환경변수 ${src.envVar}` : '인증키 불필요'} · 저장범위{' '}
                        {src.storagePermission}
                      </p>
                      <p className="text-[11px] text-stone-600 leading-relaxed">{src.termsSummary}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 flex flex-wrap items-center gap-2">
                    <select
                      aria-label="국내 핵심 검색어 선택"
                      value={
                        sourcesStatus?.koreanKeywords?.core?.includes(nanetQuery) ||
                        sourcesStatus?.koreanKeywords?.extended?.includes(nanetQuery)
                          ? nanetQuery
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) setNanetQuery(e.target.value);
                      }}
                      className="px-2.5 py-1.5 text-xs border border-stone-300 rounded-md bg-white text-stone-700"
                    >
                      <option value="">검색어 프리셋 (30개)</option>
                      {(sourcesStatus?.koreanKeywords?.core || []).map((kw) => (
                        <option key={`core_${kw}`} value={kw}>
                          [핵심] {kw}
                        </option>
                      ))}
                      {(sourcesStatus?.koreanKeywords?.extended || []).map((kw) => (
                        <option key={`ext_${kw}`} value={kw}>
                          [확장] {kw}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={nanetQuery}
                      onChange={(e) => setNanetQuery(e.target.value)}
                      placeholder="국회도서관 테스트 검색어 (예: 청소년지도)"
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-stone-300 rounded-md bg-white focus:outline-none focus:border-[#002968]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleNanetSearchTest}
                    disabled={nanetTesting}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {nanetTesting ? '검색 테스트 중...' : '국회도서관 실데이터 검색 테스트'}
                  </button>
                </div>

                {nanetTestResult && (
                  <div
                    className={`rounded-md border p-3 text-xs space-y-2 ${
                      nanetTestResult.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : nanetTestResult.status === 'ready_needs_key'
                          ? 'bg-amber-50 border-amber-200 text-amber-950'
                          : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <p className="font-semibold">{nanetTestResult.message}</p>
                    {nanetTestResult.papers.length > 0 && (
                      <ul className="space-y-1.5 pt-1 border-t border-emerald-200/70">
                        {nanetTestResult.papers.slice(0, 5).map((item) => (
                          <li key={item.sourceId} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-stone-900 truncate">{item.title}</p>
                              <p className="text-[11px] text-stone-600 truncate">
                                {item.authors.join(', ')} · {item.journalName} ·{' '}
                                {item.publicationDate || '발행일 미상'}
                              </p>
                            </div>
                            <a
                              href={item.paperUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-semibold text-[#002968] hover:underline whitespace-nowrap shrink-0"
                            >
                              원문 확인
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 5: KAKAOTALK SETTINGS */}
      {subTab === 'kakao' && (
        <section className="max-w-2xl rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-bold text-stone-900 mb-1">카카오톡 오픈채팅방 연결 설정</h2>
          <p className="text-xs text-stone-500 mb-5">
            승인된 원우회원에게만 공개되는 카카오톡 오픈채팅 URL, 참여코드, 이용 수칙을 관리합니다.
          </p>
          <form onSubmit={handleSaveKakaoLinks} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                공식 전체 채팅방 제목 <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={mainChatTitle}
                onChange={(e) => setMainChatTitle(e.target.value)}
                placeholder="명지대 청소년지도학과 원우회 공식 오픈채팅방"
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  오픈채팅방 URL <span className="text-red-600">*</span>
                </label>
                <input
                  type="url"
                  required
                  maxLength={400}
                  value={mainChatUrl}
                  onChange={(e) => setMainChatUrl(e.target.value)}
                  placeholder="https://open.kakao.com/o/..."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  참여코드 (선택)
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={mainChatPasscode}
                  onChange={(e) => setMainChatPasscode(e.target.value)}
                  placeholder="mju2026"
                  className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  학술·논문 스터디방 제목 (선택)
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={studyChatTitle}
                  onChange={(e) => setStudyChatTitle(e.target.value)}
                  placeholder="대학원 논문·연구방법론 스터디방"
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  스터디방 URL (선택)
                </label>
                <input
                  type="url"
                  maxLength={400}
                  value={studyChatUrl}
                  onChange={(e) => setStudyChatUrl(e.target.value)}
                  placeholder="https://open.kakao.com/o/..."
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                채팅방 이용 수칙 안내
              </label>
              <textarea
                rows={4}
                maxLength={1000}
                value={roomRules}
                onChange={(e) => setRoomRules(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:border-[#002968]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingKakao}
                className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md cursor-pointer"
              >
                {savingKakao ? '저장 중...' : '카카오톡 연결 설정 저장'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Activity Create / Edit Modal */}
      {activityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-stone-900/35 backdrop-blur-[1px]"
            onClick={() => setActivityModalOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-2xl bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-[#F7F6F3]">
              <h2 className="text-base font-bold text-stone-900">
                {editingActivity ? '원우회 활동 수정' : '새 원우회 활동 등록'}
              </h2>
              <button
                type="button"
                onClick={() => setActivityModalOpen(false)}
                className="p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveActivity}
              className="p-6 space-y-4 max-h-[82vh] overflow-y-auto"
            >
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  활동 제목 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.title}
                  value={actTitle}
                  onChange={(e) => setActTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">분류</label>
                  <select
                    value={actCategory}
                    onChange={(e) => setActCategory(e.target.value as ActivityCategory)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white"
                  >
                    <option value="학술·세미나">학술·세미나</option>
                    <option value="원우 교류">원우 교류</option>
                    <option value="현장 탐방">현장 탐방</option>
                    <option value="공지사항">공지사항</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    일시 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.eventDate}
                    value={actDate}
                    onChange={(e) => setActDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    장소 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={LIMITS.location}
                    value={actLocation}
                    onChange={(e) => setActLocation(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-stone-700">
                  대표 이미지 선택 및 변경
                </label>
                <div className="aspect-[16/7] w-full rounded-lg overflow-hidden border border-stone-200 bg-stone-100">
                  <ResilientImage
                    src={actImageUrl}
                    alt="활동 이미지 미리보기"
                    className="w-full h-full object-cover"
                    fallbackTitle="활동 이미지 미리보기"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {ACTIVITY_PRESET_IMAGES.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setActImageUrl(preset.url)}
                      className={`text-left rounded-md border p-1.5 text-[11px] cursor-pointer ${
                        resolveAssetUrl(actImageUrl) === resolveAssetUrl(preset.url)
                          ? 'border-[#002968] bg-[#F4F7FB] font-semibold text-[#002968]'
                          : 'border-stone-200 text-stone-600'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  maxLength={LIMITS.url}
                  value={actImageUrl}
                  onChange={(e) => setActImageUrl(e.target.value)}
                  placeholder="또는 이미지 URL 직접 입력 (https://...)"
                  className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  한 줄 요약 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={LIMITS.summary}
                  value={actSummary}
                  onChange={(e) => setActSummary(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  상세 내용 <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={5}
                  required
                  maxLength={LIMITS.activityContent}
                  value={actContent}
                  onChange={(e) => setActContent(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={actPublished}
                  onChange={(e) => setActPublished(e.target.checked)}
                />
                홈 및 활동 페이지에 공개하기
              </label>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActivityModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-stone-700 border border-stone-200 rounded-md cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingActivity}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md cursor-pointer"
                >
                  {savingActivity ? '저장 중...' : editingActivity ? '수정 저장' : '활동 등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
