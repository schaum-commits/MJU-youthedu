import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Search, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DegreeProgram, MemberPublic, PageTab } from '../types/community';
import { MemberAccessGate } from './NotionPrimitives';

const PROGRAMS: ('전체' | DegreeProgram)[] = [
  '전체',
  '석사과정',
  '박사과정',
  '석박사통합과정',
];

export function MemberDirectoryPage({
  onOpenApplicationModal,
  onNavigate,
}: {
  onOpenApplicationModal: () => void;
  onNavigate: (tab: PageTab) => void;
}) {
  const { authUser, isApprovedMember } = useAuth();
  const [members, setMembers] = useState<MemberPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [programFilter, setProgramFilter] = useState<'전체' | DegreeProgram>('전체');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isApprovedMember) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, 'membersPublic'), orderBy('displayName', 'asc')),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as MemberPublic));
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'membersPublic');
      }
    );
    return unsub;
  }, [isApprovedMember]);

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (programFilter !== '전체' && m.program !== programFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          m.displayName.toLowerCase().includes(q) ||
          m.cohort.toLowerCase().includes(q) ||
          m.roleTitle.toLowerCase().includes(q) ||
          (m.researchInterest || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [members, programFilter, search]);

  if (!isApprovedMember) {
    return (
      <MemberAccessGate
        sectionTitle="원우 네트워크 디렉토리"
        description="승인된 원우들의 기수, 학위과정, 관심 연구 분야 목록은 원우회원만 열람할 수 있습니다."
        onOpenApplicationModal={onOpenApplicationModal}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-6">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">원우 네트워크</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            청소년지도학과 원우 디렉토리
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            승인된 원우들의 학위 과정과 관심 연구 분야를 확인하고 공동 연구 및 스터디를 연결하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenApplicationModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserCheck className="w-3.5 h-3.5 text-[#002968]" />
          내 연구 관심사 수정
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto">
          {PROGRAMS.map((prog) => (
            <button
              key={prog}
              type="button"
              onClick={() => setProgramFilter(prog)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                programFilter === prog
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {prog}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 기수, 연구 분야 검색"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-stone-200 p-6 animate-pulse space-y-3">
          <div className="h-4 w-full bg-stone-100 rounded" />
          <div className="h-4 w-full bg-stone-100 rounded" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-10 text-center">
          <p className="text-sm text-stone-600">조건에 맞는 원우 정보가 없습니다.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-stone-200 bg-[#F7F6F3] text-xs font-semibold text-stone-600">
                <th className="py-3 px-4">이름</th>
                <th className="py-3 px-4">원우회 직책</th>
                <th className="py-3 px-4">과정 · 상태</th>
                <th className="py-3 px-4">입학 기수</th>
                <th className="py-3 px-4">관심 연구 분야</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-sm">
              {filtered.map((m) => (
                <tr key={m.uid} className="hover:bg-[#F7F6F3]/60 transition-colors">
                  <td className="py-3 px-4 font-semibold text-stone-900 whitespace-nowrap">
                    {m.displayName}
                    {m.uid === authUser?.uid && (
                      <span className="ml-1.5 text-[11px] font-medium text-[#002968]">(나)</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-stone-700 whitespace-nowrap">
                    {m.roleTitle}
                  </td>
                  <td className="py-3 px-4 text-xs text-stone-600 whitespace-nowrap">
                    {m.program} · {m.academicStatus}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums text-stone-600 whitespace-nowrap">
                    {m.cohort}
                  </td>
                  <td className="py-3 px-4 text-xs text-stone-600">
                    {m.researchInterest || '미입력'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
