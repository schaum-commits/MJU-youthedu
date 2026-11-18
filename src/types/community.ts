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
  | 'trends'
  | 'kakao'
  | 'directory'
  | 'admin';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'schaum@mju.ac.kr';

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
