/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useEffect, useRef, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import {
  checkResearchServerAvailable,
  RESEARCH_SYNC_INTERVAL_MS,
  runResearchSync,
} from './lib/researchSync';
import {
  collectAndAnalyzePapers,
  isMonthlySyncDue,
} from './lib/youthPaperSync';
import {
  CommunityLinks,
  CouncilActivity,
  DEFAULT_KAKAO_CHAT_URL,
  MonthlyTrendReport,
  PageTab,
  PaperRecord,
  PublicSettings,
  ResearchSyncStatus,
  ResearchTrend,
  resolveKakaoChatUrl,
} from './types/community';
import { NotionSidebar } from './components/NotionSidebar';
import { TopBreadcrumbBar } from './components/TopBreadcrumbBar';
import { MembershipApplicationModal } from './components/MembershipApplicationModal';
import { HomePage } from './components/HomePage';
import { ActivitiesPage } from './components/ActivitiesPage';
import { MemberBoardPage } from './components/MemberBoardPage';
import { ResearchTrendsPage } from './components/ResearchTrendsPage';
import { YouthResearchTrendsPage } from './components/YouthResearchTrendsPage';
import { KakaoLoungePage } from './components/KakaoLoungePage';
import { MemberDirectoryPage } from './components/MemberDirectoryPage';
import { AdminConsolePage } from './components/AdminConsolePage';

class CommunityErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-stone-200 bg-white p-6 space-y-3 text-center">
            <h1 className="text-lg font-bold text-stone-900">페이지를 불러오는 중 문제가 발생했습니다</h1>
            <p className="text-xs text-stone-600 leading-relaxed">
              권한 상태가 변경되었거나 네트워크 연결이 일시적으로 중단되었습니다. 새로고침 후 다시 시도해 주세요.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md cursor-pointer"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function WorkspaceShell() {
  const {
    authReady,
    authUser,
    profile,
    profileLoading,
    isAdmin,
    isApprovedMember,
    authError,
    clearAuthError,
  } = useAuth();
  const [activeTab, setActiveTab] = useState<PageTab>('home');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [applicationModalOpen, setApplicationModalOpen] = useState(false);
  const autoOpenedModalRef = useRef(false);

  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [activities, setActivities] = useState<CouncilActivity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<CouncilActivity | null>(null);
  const [pendingMemberCount, setPendingMemberCount] = useState(0);
  const [kakaoChatUrl, setKakaoChatUrl] = useState(DEFAULT_KAKAO_CHAT_URL);
  const [researchSyncStatus, setResearchSyncStatus] = useState<ResearchSyncStatus | null>(null);
  const [researchSyncLoaded, setResearchSyncLoaded] = useState(false);
  const autoSyncAttemptedRef = useRef(false);
  const [papers, setPapers] = useState<PaperRecord[]>([]);
  const [papersLoaded, setPapersLoaded] = useState(false);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyTrendReport[]>([]);
  const monthlyAutoAttemptedRef = useRef(false);

  useEffect(() => {
    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'public'),
      (snap) => {
        if (snap.exists()) {
          setPublicSettings(snap.data() as PublicSettings);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/public')
    );

    return unsubSettings;
  }, []);

  useEffect(() => {
    if (!authUser) {
      autoOpenedModalRef.current = false;
      return;
    }
    if (authReady && !profileLoading && !profile && !isAdmin && !autoOpenedModalRef.current) {
      autoOpenedModalRef.current = true;
      setApplicationModalOpen(true);
    }
  }, [authReady, authUser, profileLoading, profile, isAdmin]);

  useEffect(() => {
    if (!authReady || !isAdmin) {
      setPendingMemberCount(0);
      return;
    }
    const q = query(collection(db, 'users'), where('status', '==', 'pending'));
    const unsubPending = onSnapshot(
      q,
      (snap) => {
        setPendingMemberCount(snap.size);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'users')
    );
    return unsubPending;
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady || !isApprovedMember) {
      setKakaoChatUrl(DEFAULT_KAKAO_CHAT_URL);
      return;
    }
    const unsubLinks = onSnapshot(
      doc(db, 'settings', 'communityLinks'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as CommunityLinks;
          setKakaoChatUrl(resolveKakaoChatUrl(data.mainChatUrl));
        } else {
          setKakaoChatUrl(DEFAULT_KAKAO_CHAT_URL);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/communityLinks')
    );
    return unsubLinks;
  }, [authReady, isApprovedMember]);

  useEffect(() => {
    if (!authReady) return;
    const activitiesQuery = isAdmin
      ? query(collection(db, 'activities'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'activities'), where('isPublished', '==', true));

    const unsubActivities = onSnapshot(
      activitiesQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CouncilActivity, 'id'>),
        }));
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setActivities(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'activities')
    );

    return unsubActivities;
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady) return;
    const unsubSync = onSnapshot(
      doc(db, 'settings', 'researchSync'),
      (snap) => {
        setResearchSyncStatus(snap.exists() ? (snap.data() as ResearchSyncStatus) : null);
        setResearchSyncLoaded(true);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'settings/researchSync')
    );
    return unsubSync;
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const papersQuery = isAdmin
      ? query(collection(db, 'papers'))
      : query(collection(db, 'papers'), where('isPublished', '==', true));

    const unsubPapers = onSnapshot(
      papersQuery,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as PaperRecord);
        list.sort((a, b) => {
          const dateDiff = (b.publicationDate || '').localeCompare(a.publicationDate || '');
          if (dateDiff !== 0) return dateDiff;
          return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
        });
        setPapers(list);
        setPapersLoaded(true);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'papers')
    );

    const reportsQuery = isAdmin
      ? query(collection(db, 'monthlyReports'))
      : query(collection(db, 'monthlyReports'), where('isPublished', '==', true));

    const unsubReports = onSnapshot(
      reportsQuery,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as MonthlyTrendReport);
        list.sort((a, b) => (b.reportId || '').localeCompare(a.reportId || ''));
        setMonthlyReports(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'monthlyReports')
    );

    return () => {
      unsubPapers();
      unsubReports();
    };
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authUser) {
      autoSyncAttemptedRef.current = false;
      monthlyAutoAttemptedRef.current = false;
      return;
    }
    if (!authReady || !isAdmin || !researchSyncLoaded || autoSyncAttemptedRef.current) {
      return;
    }

    const lastSyncedMs = researchSyncStatus?.lastSyncedAt?.toMillis?.() ?? null;
    const isInitialSyncNeeded = !researchSyncStatus || lastSyncedMs === null;
    const isBiweeklyDue =
      Boolean(researchSyncStatus?.autoEnabled !== false) &&
      lastSyncedMs !== null &&
      Date.now() - lastSyncedMs >= RESEARCH_SYNC_INTERVAL_MS;

    if (!isInitialSyncNeeded && !isBiweeklyDue) {
      return;
    }

    autoSyncAttemptedRef.current = true;
    const mode = isInitialSyncNeeded ? 'initial_1y' : 'biweekly';

    void (async () => {
      const serverAvailable = await checkResearchServerAvailable();
      if (!serverAvailable) return;

      try {
        const trendsSnap = await getDocs(collection(db, 'researchTrends'));
        const existingTrends = trendsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ResearchTrend, 'id'>),
        }));
        await runResearchSync({
          mode,
          authUser,
          actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
          existingTrends,
          autoEnabled: researchSyncStatus?.autoEnabled ?? true,
          currentStatus: researchSyncStatus,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'researchTrends');
      }
    })();
  }, [authReady, authUser, isAdmin, profile, researchSyncLoaded, researchSyncStatus]);

  useEffect(() => {
    if (!authUser || !authReady || !isAdmin || !researchSyncLoaded || !papersLoaded) {
      return;
    }
    if (monthlyAutoAttemptedRef.current) return;
    if (!isMonthlySyncDue({ researchSyncStatus, papersCount: papers.length })) {
      return;
    }

    monthlyAutoAttemptedRef.current = true;

    void (async () => {
      const serverAvailable = await checkResearchServerAvailable();
      if (!serverAvailable) return;

      await collectAndAnalyzePapers({
        triggerType: 'scheduled_monthly',
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingPapers: papers,
        autoEnabled: researchSyncStatus?.autoEnabled ?? true,
        currentStatus: researchSyncStatus,
        perCategoryLimit: 2,
        generateReportToo: true,
      });
    })();
  }, [
    authReady,
    authUser,
    isAdmin,
    papers,
    papersLoaded,
    profile,
    researchSyncLoaded,
    researchSyncStatus,
  ]);

  const handleOpenActivityFromHome = (activity: CouncilActivity) => {
    setSelectedActivity(activity);
    setActiveTab('activities');
  };

  return (
    <div className="min-h-screen flex bg-white text-stone-900">
      <NotionSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onOpenApplicationModal={() => setApplicationModalOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <TopBreadcrumbBar
          activeTab={activeTab}
          kakaoChatUrl={kakaoChatUrl}
          onSelectTab={setActiveTab}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          onOpenApplicationModal={() => setApplicationModalOpen(true)}
        />

        {authError && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 flex items-center justify-between text-xs text-red-800">
            <span>{authError}</span>
            <button
              type="button"
              onClick={clearAuthError}
              className="underline font-medium cursor-pointer"
            >
              닫기
            </button>
          </div>
        )}

        <main className="flex-1">
          {activeTab === 'home' && (
            <HomePage
              publicSettings={publicSettings}
              activities={activities}
              pendingMemberCount={pendingMemberCount}
              onNavigate={setActiveTab}
              onOpenActivity={handleOpenActivityFromHome}
              onOpenApplicationModal={() => setApplicationModalOpen(true)}
            />
          )}

          {activeTab === 'activities' && (
            <ActivitiesPage
              activities={activities}
              selectedActivity={selectedActivity}
              onSelectActivity={setSelectedActivity}
              onNavigateToAdminActivities={() => setActiveTab('admin')}
            />
          )}

          {activeTab === 'board' && (
            <MemberBoardPage
              onOpenApplicationModal={() => setApplicationModalOpen(true)}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'trends' && (
            <ResearchTrendsPage
              researchSyncStatus={researchSyncStatus}
              onOpenApplicationModal={() => setApplicationModalOpen(true)}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'youthTrends' && (
            <YouthResearchTrendsPage
              papers={papers}
              monthlyReports={monthlyReports}
              researchSyncStatus={researchSyncStatus}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'kakao' && (
            <KakaoLoungePage
              onOpenApplicationModal={() => setApplicationModalOpen(true)}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'directory' && (
            <MemberDirectoryPage
              onOpenApplicationModal={() => setApplicationModalOpen(true)}
              onNavigate={setActiveTab}
            />
          )}

          {activeTab === 'admin' && (
            <AdminConsolePage
              publicSettings={publicSettings}
              activities={activities}
              researchSyncStatus={researchSyncStatus}
              papers={papers}
              monthlyReports={monthlyReports}
            />
          )}
        </main>

        <footer className="border-t border-stone-200 bg-[#FBFBFA] px-6 sm:px-10 py-5 text-xs text-stone-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>명지대학교 대학원 청소년지도학과 원우회</span>
          <span>서울특별시 서대문구 거북골로 34 명지대학교 인문캠퍼스</span>
        </footer>
      </div>

      <MembershipApplicationModal
        open={applicationModalOpen}
        onClose={() => setApplicationModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <CommunityErrorBoundary>
      <AuthProvider>
        <WorkspaceShell />
      </AuthProvider>
    </CommunityErrorBoundary>
  );
}
