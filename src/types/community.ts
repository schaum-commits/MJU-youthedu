import { Timestamp } from 'firebase/firestore';

export type DegreeProgram = '석사과정' | '박사과정' | '석박사통합과정';
export type AcademicStatus = '재학' | '수료' | '졸업';
export type MembershipStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type ActivityCategory = '학술·세미나' | '원우 교류' | '현장 탐방' | '공지사항';
export type BoardCategory = '공지사항' | '스터디 모집' | '학사·논문 Q&A' | '자유게시판';
export type RecruitStatus = '모집중' | '마감' | '해당없음';
export type TrendCategory =
  | '청소년정책·제도'
  | '상담·심리지원'
  | '디지털·미디어'
  | '진로·자립지원'
  | '학술논문·방법론'
  | '학회·공모전';

export type PageTab =
  | 'home'
  | 'activities'
  | 'board'
  | 'youthTrends'
  | 'kakao'
  | 'directory'
  | 'admin';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'schaum@mju.ac.kr';

export const DEFAULT_KAKAO_CHAT_URL = 'https://invite.kakao.com/tc/sFZLj874sv';

export function resolveKakaoChatUrl(url?: string): string {
  const trimmed = url?.trim();
  if (!trimmed || trimmed === 'https://open.kakao.com/o/mju-youth-council-demo') {
    return DEFAULT_KAKAO_CHAT_URL;
  }
  return trimmed;
}

export function formatAdmissionTerm(value?: string): string {
  const trimmed = value?.trim() || '';
  if (!trimmed || trimmed === '제18대 원우회') {
    return '2026학년도 1학기';
  }
  return trimmed;
}

export const COVER_IMAGE_URL = './src/assets/images/mju_bangmok_campus_1794821245874.jpg';

export const ACTIVITY_PRESET_IMAGES = [
  {
    label: '명지대 방목학술정보관',
    url: './src/assets/images/mju_bangmok_campus_1794821245874.jpg',
  },
  {
    label: '대학원 오리엔테이션',
    url: './src/assets/images/activity_orientation_1794820293430.jpg',
  },
  {
    label: '학술 콜로퀴엄·세미나',
    url: './src/assets/images/activity_colloquium_1794820293288.jpg',
  },
  {
    label: '청소년기관 현장 탐방',
    url: './src/assets/images/activity_fieldtrip_1794820292222.jpg',
  },
  {
    label: '명지대 캠퍼스 교정',
    url: './src/assets/images/mju_campus_cover_1794820292268.jpg',
  },
];

export const LIMITS = {
  displayName: 60,
  cohort: 40,
  studentId: 30,
  researchInterest: 200,
  applicationNote: 400,
  roleTitle: 60,
  title: 120,
  trendTitle: 150,
  summary: 300,
  activityContent: 6000,
  boardContent: 10000,
  trendSummary: 5000,
  keyTakeaway: 500,
  commentContent: 1500,
  studySchedule: 120,
  source: 100,
  publishedPeriod: 30,
  url: 400,
  trendUrl: 500,
  location: 120,
  eventDate: 40,
} as const;

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  cohort: string;
  program: DegreeProgram;
  academicStatus: AcademicStatus;
  studentId: string;
  researchInterest?: string;
  applicationNote?: string;
  status: MembershipStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberPublic {
  uid: string;
  displayName: string;
  cohort: string;
  program: DegreeProgram;
  academicStatus: AcademicStatus;
  researchInterest?: string;
  roleTitle: string;
  updatedAt: Timestamp;
}

export interface AdminRecord {
  uid: string;
  email: string;
  displayName: string;
  grantedBy: string;
  createdAt: Timestamp;
}

export interface PublicSettings {
  councilName: string;
  semesterLabel: string;
  welcomeHeadline: string;
  welcomeSummary: string;
  executiveNotice?: string;
  departmentIntro?: string;
  coverImageUrl?: string;
  updatedAt: Timestamp;
}

export interface CommunityLinks {
  mainChatTitle: string;
  mainChatUrl: string;
  mainChatPasscode?: string;
  studyChatTitle?: string;
  studyChatUrl?: string;
  roomRules?: string;
  updatedAt: Timestamp;
}

export interface CouncilActivity {
  id: string;
  title: string;
  category: ActivityCategory;
  eventDate: string;
  location: string;
  summary: string;
  content: string;
  imageUrl?: string;
  isPublished: boolean;
  authorUid: string;
  authorName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BoardPost {
  id: string;
  title: string;
  category: BoardCategory;
  content: string;
  isPinned: boolean;
  recruitStatus: RecruitStatus;
  studySchedule?: string;
  authorUid: string;
  authorName: string;
  authorCohort: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BoardComment {
  id: string;
  postId: string;
  authorUid: string;
  authorName: string;
  authorCohort: string;
  content: string;
  createdAt: Timestamp;
}

export interface ResearchTrend {
  id: string;
  title: string;
  category: TrendCategory;
  source: string;
  publishedPeriod: string;
  externalUrl?: string;
  summary: string;
  keyTakeaway?: string;
  isPinned: boolean;
  authorUid: string;
  authorName: string;
  authorCohort: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ResearchComment {
  id: string;
  trendId: string;
  authorUid: string;
  authorName: string;
  authorCohort: string;
  content: string;
  createdAt: Timestamp;
}

export interface TrendBookmark {
  trendId: string;
  title: string;
  createdAt: Timestamp;
}

export type ResearchSyncStatusType = 'idle' | 'syncing' | 'success' | 'error';
export type ResearchSyncMode = 'initial_1y' | 'biweekly' | 'monthly' | 'manual';

export interface ResearchSyncStatus {
  autoEnabled: boolean;
  intervalDays: number;
  lastSyncedAt?: Timestamp;
  nextSyncAt?: Timestamp;
  lastSyncStatus: ResearchSyncStatusType;
  lastSyncMode?: ResearchSyncMode;
  lastSyncCount: number;
  lastSyncMessage?: string;
  windowLabel?: string;
  scheduleCron?: string;
  timezone?: string;
  koreanCoverageNotice?: string;
  updatedByUid: string;
  updatedByName: string;
  updatedAt: Timestamp;
}

export const YOUTH_RESEARCH_CATEGORIES = [
  '청소년지도 및 청소년 활동',
  '청소년 진로 및 리더십',
  '청소년 참여 및 사회적 성장',
  'AI 및 디지털 시대의 청소년',
  '청소년 교육 및 평생학습',
  '청소년 문제 및 사회 변화',
] as const;

export type YouthResearchCategory = (typeof YOUTH_RESEARCH_CATEGORIES)[number];

export interface PaperRecord {
  paperId: string;
  title: string;
  authors: string[];
  journalName: string;
  publicationDate: string;
  language: string;
  region: 'domestic' | 'international';
  abstract: string;
  keywords: string[];
  doi?: string;
  openAlexId?: string;
  crossrefId?: string;
  paperUrl?: string;
  source: string;
  openAccess: boolean;
  citedByCount?: number;
  mainCategory: YouthResearchCategory;
  relatedCategories: YouthResearchCategory[];
  researchPurpose?: string;
  researchBackground?: string;
  researchQuestion?: string;
  researchMethod?: string;
  researchTarget?: string;
  researchFindings?: string;
  researchLimitations?: string;
  practicalImplications?: string;
  policyImplications?: string;
  easySummary?: string;
  analysisBasis: string;
  analysisStatus: 'completed' | 'failed' | 'pending';
  analysisError?: string;
  isPublished: boolean;
  aiAnalysisDate?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MonthlyTrendReport {
  reportId: string;
  monthLabel: string;
  periodRange: string;
  totalPapersCount: number;
  newPapersCount: number;
  domesticCount: number;
  internationalCount: number;
  categoryFlows: string;
  notablePapers: string;
  keyThemes: string;
  commonFindings: string;
  researchGaps: string;
  fieldImplications: string;
  isPublished: boolean;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ResearchSyncLog {
  logId: string;
  triggerType: 'manual' | 'scheduled_monthly' | 'retry_failed';
  status: 'success' | 'partial' | 'error';
  collectedCount: number;
  newPapersCount: number;
  domesticCount: number;
  internationalCount: number;
  analyzedSuccessCount: number;
  analyzedFailedCount: number;
  openAlexCalls: number;
  crossrefCalls: number;
  geminiCalls: number;
  estimatedTokens: number;
  collectionErrors: string[];
  analysisErrors: string[];
  koreanCoverageNotice?: string;
  executedByUid: string;
  executedByName: string;
  createdAt: Timestamp;
}


