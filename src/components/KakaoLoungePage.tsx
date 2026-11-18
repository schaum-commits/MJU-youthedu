import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Check, Copy, ExternalLink, MessageCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { CommunityLinks, PageTab, resolveKakaoChatUrl } from '../types/community';
import { MemberAccessGate, NotionCallout } from './NotionPrimitives';

export function KakaoLoungePage({
  onOpenApplicationModal,
  onNavigate,
}: {
  onOpenApplicationModal: () => void;
  onNavigate: (tab: PageTab) => void;
}) {
  const { isAdmin, isApprovedMember } = useAuth();
  const [links, setLinks] = useState<CommunityLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedPasscode, setCopiedPasscode] = useState(false);

  useEffect(() => {
    if (!isApprovedMember) {
      setLinks(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'settings', 'communityLinks'),
      (snap) => {
        if (snap.exists()) {
          setLinks(snap.data() as CommunityLinks);
        } else {
          setLinks(null);
        }
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/communityLinks');
      }
    );
    return unsub;
  }, [isApprovedMember]);

  if (!isApprovedMember) {
    return (
      <MemberAccessGate
        sectionTitle="카카오톡 원우 오픈채팅 라운지"
        description="원우회 공식 카카오톡 오픈채팅방 링크와 참여코드는 보안을 위해 승인된 명지대학교 대학원 청소년지도학과 원우회원에게만 공개됩니다."
        onOpenApplicationModal={onOpenApplicationModal}
        onNavigate={onNavigate}
      />
    );
  }

  const handleCopyPasscode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedPasscode(true);
      setTimeout(() => setCopiedPasscode(false), 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-8">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">실시간 소통 채널</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            카카오톡 원우 오픈채팅 라운지
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            학사 안내, 세미나 공지, 원우 간 일상 소통이 이루어지는 공식 카카오톡 채팅방으로 연결됩니다.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => onNavigate('admin')}
            className="px-3.5 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            채팅방 링크 수정
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-stone-200 p-8 animate-pulse space-y-4">
          <div className="h-5 w-48 bg-stone-200 rounded" />
          <div className="h-12 w-full bg-stone-100 rounded" />
        </div>
      ) : !links ? (
        <NotionCallout
          icon={<MessageCircle className="w-5 h-5" />}
          title="오픈채팅방 링크가 아직 등록되지 않았습니다"
          tone="amber"
        >
          관리자 콘솔의 [카카오톡 채팅방 설정] 탭에서 원우회 오픈채팅 URL과 참여코드를 등록해
          주세요.
        </NotionCallout>
      ) : (
        <div className="space-y-6">
          {/* Primary KakaoTalk Room Card */}
          <section className="rounded-xl border border-stone-200 bg-white p-6 sm:p-7">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-medium text-stone-500 mb-1">공식 원우 전체 채팅방</p>
                <h2 className="text-lg font-bold text-stone-900">{links.mainChatTitle}</h2>
              </div>
              <a
                href={resolveKakaoChatUrl(links.mainChatUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-stone-900 bg-[#FEE500] hover:bg-[#F5DC00] border border-[#E5CE00] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MessageCircle className="w-4 h-4" />
                카카오톡 채팅방 열기
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {links.mainChatPasscode && (
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-stone-500">오픈채팅방 참여코드</p>
                  <p className="text-sm font-mono font-semibold text-stone-900 mt-0.5 tabular-nums">
                    {links.mainChatPasscode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyPasscode(links.mainChatPasscode!)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md transition-colors cursor-pointer"
                >
                  {copiedPasscode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      복사 완료
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      참여코드 복사
                    </>
                  )}
                </button>
              </div>
            )}
          </section>

          {/* Secondary Study Chat Room */}
          {links.studyChatUrl && (
            <section className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-stone-500 mb-1">학술·논문 스터디 채널</p>
                <h3 className="text-base font-bold text-stone-900">
                  {links.studyChatTitle || '대학원 논문·연구 스터디 오픈채팅'}
                </h3>
              </div>
              <a
                href={links.studyChatUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                스터디 채팅방 참여
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </section>
          )}

          {/* Etiquette Rules */}
          {links.roomRules && (
            <NotionCallout
              icon={<ShieldCheck className="w-5 h-5" />}
              title="원우회 오픈채팅방 이용 안내"
              tone="neutral"
            >
              <div className="whitespace-pre-line">
                {links.roomRules.replace(
                  /\[(?:기수|입학년도\/학기)\/과정\/이름\]/g,
                  '[입학년도/과정/이름]'
                )}
              </div>
            </NotionCallout>
          )}
        </div>
      )}
    </div>
  );
}
