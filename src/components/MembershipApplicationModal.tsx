import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AcademicStatus, DegreeProgram, LIMITS } from '../types/community';

export function MembershipApplicationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { authUser, profile, submitApplication, updateMyProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [admissionYear, setAdmissionYear] = useState('2026');
  const [admissionSemester, setAdmissionSemester] = useState<'1학기' | '2학기'>('1학기');
  const [program, setProgram] = useState<DegreeProgram>('석사과정');
  const [academicStatus, setAcademicStatus] = useState<AcademicStatus>('재학');
  const [studentId, setStudentId] = useState('');
  const [researchInterest, setResearchInterest] = useState('');
  const [applicationNote, setApplicationNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const yearOptions = Array.from({ length: 15 }, (_, idx) => String(2027 - idx));

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    if (profile) {
      setDisplayName(profile.displayName || '');
      const rawCohort = profile.cohort || '';
      const yearMatch = rawCohort.match(/(20\d{2})/);
      setAdmissionYear(yearMatch ? yearMatch[1] : '2026');
      setAdmissionSemester(/(2학기|후기)/.test(rawCohort) ? '2학기' : '1학기');
      setProgram(profile.program || '석사과정');
      setAcademicStatus(profile.academicStatus || '재학');
      setStudentId(profile.studentId || '');
      setResearchInterest(profile.researchInterest || '');
      setApplicationNote(profile.applicationNote || '');
    } else if (authUser) {
      setDisplayName(authUser.displayName || '');
      setAdmissionYear('2026');
      setAdmissionSemester('1학기');
      setProgram('석사과정');
      setAcademicStatus('재학');
      setStudentId('');
      setResearchInterest('');
      setApplicationNote('');
    }
  }, [open, profile, authUser]);

  if (!open || !authUser) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cohort = `${admissionYear}학년도 ${admissionSemester}`;

    if (!displayName.trim() || !cohort.trim() || !studentId.trim()) {
      setErrorMsg('이름, 입학년도/입학학기, 학번을 모두 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        displayName,
        cohort,
        program,
        academicStatus,
        studentId,
        researchInterest,
        applicationNote,
      };
      if (profile) {
        await updateMyProfile(payload);
        setSuccessMsg('원우 정보가 저장되었습니다.');
      } else {
        await submitApplication(payload);
        setSuccessMsg(
          '회원 가입 신청이 접수되었습니다. 관리자가 확인 후 회원 인증을 완료하면 모든 회원 전용 메뉴를 이용하실 수 있습니다.'
        );
      }
      setTimeout(() => {
        onClose();
      }, 1100);
    } catch {
      setErrorMsg('저장 중 오류가 발생했습니다. 입력 값을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-stone-900/35 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg bg-white rounded-xl border border-stone-200 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-[#F7F6F3]">
          <div>
            <h2 className="text-base font-bold text-stone-900">
              {profile ? '내 원우 정보 수정' : '청소년지도학과 원우회 회원 가입 신청'}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">{authUser.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-stone-500 hover:bg-stone-200/70 cursor-pointer"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {!profile && (
            <div className="rounded-lg border border-[#D5DFEE] bg-[#F4F7FB] px-3.5 py-2.5 text-xs text-stone-700 leading-relaxed">
              가입 신청서를 제출하면 <strong className="text-stone-900">관리자 회원 인증 대기</strong>{' '}
              상태로 등록됩니다. 원우회 관리자가 학번·입학년도/입학학기를 확인해 인증을 완료하면 회원 전용 게시판과 연구 동향, 오픈채팅방이 즉시 열립니다.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                성명 <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={LIMITS.displayName}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="홍길동"
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                학번 (관리자 확인용 비공개) <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={LIMITS.studentId}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="예: 202612345"
                className="w-full px-3 py-2 text-sm font-mono border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                입학년도 <span className="text-red-600">*</span>
              </label>
              <select
                value={admissionYear}
                onChange={(e) => setAdmissionYear(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}학년도
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                입학학기 <span className="text-red-600">*</span>
              </label>
              <select
                value={admissionSemester}
                onChange={(e) => setAdmissionSemester(e.target.value as '1학기' | '2학기')}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              >
                <option value="1학기">1학기 (전기)</option>
                <option value="2학기">2학기 (후기)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">학위 과정</label>
              <select
                value={program}
                onChange={(e) => setProgram(e.target.value as DegreeProgram)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              >
                <option value="석사과정">석사과정</option>
                <option value="박사과정">박사과정</option>
                <option value="석박사통합과정">석박사통합과정</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">학적 상태</label>
              <select
                value={academicStatus}
                onChange={(e) => setAcademicStatus(e.target.value as AcademicStatus)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
              >
                <option value="재학">재학</option>
                <option value="수료">수료</option>
                <option value="졸업">졸업</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              관심 연구 분야
            </label>
            <input
              type="text"
              maxLength={LIMITS.researchInterest}
              value={researchInterest}
              onChange={(e) => setResearchInterest(e.target.value)}
              placeholder="예: 청소년 디지털 리터러시, 학교밖 청소년 진로지원"
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1">
              원우회 확인 메모 (선택)
            </label>
            <textarea
              rows={2}
              maxLength={LIMITS.applicationNote}
              value={applicationNote}
              onChange={(e) => setApplicationNote(e.target.value)}
              placeholder="지도교수님 성함 또는 신입생/복학생 확인 사항이 있다면 적어주세요."
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}
          {successMsg && (
            <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {successMsg}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
            >
              {submitting
                ? '저장 중...'
                : profile
                  ? '정보 저장'
                  : '회원 가입 신청 (관리자 인증 요청)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
