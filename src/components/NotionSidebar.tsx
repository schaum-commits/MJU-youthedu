import React from 'react';
import {
  BookOpen,
  CalendarDays,
  FileText,
  GraduationCap,
  Home,
  Lock,
  LogIn,
  LogOut,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatAdmissionTerm, PageTab } from '../types/community';

interface NavItem {
  id: PageTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  memberOnly?: boolean;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: '홈 · 원우회 소개', icon: Home },
  { id: 'activities', label: '원우회 활동', icon: CalendarDays },
  { id: 'youthTrends', label: '청소년지도 연구동향', icon: Sparkles },
  { id: 'board', label: '회원 전용 게시판', icon: FileText, memberOnly: true },
  { id: 'trends', label: '연구 동향 아카이브', icon: BookOpen, memberOnly: true },
  { id: 'kakao', label: '카카오톡 라운지', icon: MessageCircle, memberOnly: true },
  { id: 'directory', label: '원우 네트워크', icon: Users, memberOnly: true },
  { id: 'admin', label: '관리자 콘솔', icon: ShieldCheck, adminOnly: true },
];

export function NotionSidebar({
  activeTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
  onOpenApplicationModal,
}: {
  activeTab: PageTab;
  onSelectTab: (tab: PageTab) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenApplicationModal: () => void;
}) {
  const { authUser, profile, isAdmin, isApprovedMember, loginWithGoogle, logout } = useAuth();

  const visibleItems = NAV_ITEMS;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#F7F6F3] border-r border-stone-200 select-none">
      {/* Workspace Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-stone-200/80">
        <button
          type="button"
          onClick={() => {
            onSelectTab('home');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left min-w-0 cursor-pointer"
        >
          <div className="w-7 h-7 rounded-md bg-[#002968] text-white flex items-center justify-center shrink-0">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-stone-900 truncate">명지대 청소년지도학과</p>
            <p className="text-[11px] text-stone-500 truncate">대학원 원우회 워크스페이스</p>
          </div>
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70"
          aria-label="사이드바 닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Page Tree Navigation */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-6">
        <div>
          <p className="px-2.5 mb-1.5 text-[11px] font-semibold text-stone-500 tracking-wide">
            원우회 페이지
          </p>
          <nav className="space-y-0.5" aria-label="원우회 메뉴">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isLocked =
                (item.memberOnly && !isApprovedMember) || (item.adminOnly && !isAdmin);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-stone-200/80 text-stone-900 font-semibold'
                      : 'text-stone-700 hover:bg-stone-200/50 hover:text-stone-900 font-medium'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-[#002968]' : 'text-stone-500'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {isLocked && <Lock className="w-3.5 h-3.5 text-stone-400 shrink-0" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Membership Status Summary Box */}
        <div className="px-2.5">
          <div className="rounded-lg bg-white border border-stone-200 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-stone-500">회원 인증 상태</p>
            {!authUser ? (
              <>
                <p className="text-xs text-stone-600 leading-relaxed">
                  원우회 회원만 게시판·연구동향·오픈채팅방에 접근할 수 있습니다.
                </p>
                <button
                  type="button"
                  onClick={loginWithGoogle}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Google 원우 로그인
                </button>
              </>
            ) : !profile ? (
              <>
                <p className="text-xs text-stone-700">가입 신청서 작성이 필요합니다.</p>
                <button
                  type="button"
                  onClick={onOpenApplicationModal}
                  className="w-full px-3 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  원우 가입 신청하기
                </button>
              </>
            ) : isApprovedMember ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-stone-900 truncate">
                  {profile.displayName} · {isAdmin ? '관리자' : '정회원'}
                </p>
                <p className="text-[11px] text-stone-500 truncate">
                  {formatAdmissionTerm(profile.cohort)} · {profile.program}
                </p>
                <button
                  type="button"
                  onClick={onOpenApplicationModal}
                  className="mt-1 text-[11px] font-medium text-[#002968] hover:underline cursor-pointer"
                >
                  내 정보 수정
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800">
                  {profile.status === 'pending'
                    ? '승인 대기 중'
                    : profile.status === 'suspended'
                      ? '계정 비활성화됨'
                      : '승인 보류됨'}
                </p>
                <p className="text-[11px] text-stone-500 truncate">
                  {profile.displayName} · {formatAdmissionTerm(profile.cohort)}
                </p>
                <button
                  type="button"
                  onClick={onOpenApplicationModal}
                  className="mt-1 text-[11px] font-medium text-[#002968] hover:underline cursor-pointer"
                >
                  신청 정보 확인
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Auth Footer */}
      {authUser && (
        <div className="px-3.5 py-3 border-t border-stone-200/80 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-stone-800 truncate">
              {profile?.displayName || authUser.displayName || '원우'}
            </p>
            <p className="text-[11px] text-stone-500 truncate">{authUser.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-200/70 transition-colors shrink-0 cursor-pointer"
            title="로그아웃"
            aria-label="로그아웃"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-stone-900/30"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[270px] max-w-[85vw] h-full">{sidebarContent}</aside>
        </div>
      )}
    </>
  );
}
