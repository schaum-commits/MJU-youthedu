import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { ACTIVITY_PRESET_IMAGES } from '../types/community';

export const DEFAULT_PUBLIC_SETTINGS = {
  councilName: '명지대학교 대학원 청소년지도학과 원우회',
  semesterLabel: '제18대 원우회 · 2026학년도 · 서울 인문캠퍼스',
  welcomeHeadline: '청소년학과 현장을 잇는 연구 공동체, 명지 원우회 아카이브',
  welcomeSummary:
    '명지대학교 대학원 청소년지도학과 원우회 공식 커뮤니티입니다. 학기별 주요 원우회 활동 안내, 원우 전용 공지 및 스터디 모집 게시판, 최신 청소년 정책·상담·학술 연구 동향 공유, 그리고 실시간 카카오톡 오픈채팅 라운지를 한곳에서 이용하실 수 있습니다.',
  executiveNotice:
    '2026학년도 2학기 학술 콜로퀴엄 및 논문 연구 스터디 모집이 진행 중입니다. 원우 인증 승인 후 게시판과 연구 동향 아카이브를 자유롭게 이용해 주세요.',
  departmentIntro:
    '명지대학교 대학원 청소년지도학과는 청소년의 전인적 성장과 권익 증진, 그리고 건강한 사회 환경 조성을 이끌어갈 전문 연구자 및 현장 지도자를 양성하는 학과입니다. 석사·박사 과정 원우들은 청소년 정책·제도, 상담 및 심리지원, 디지털 미디어 리터러시, 지역사회 청소년 활동 등 다학제적 연구와 현장 실천을 결합한 학술 활동을 이어가고 있습니다.',
  coverImageUrl: './src/assets/images/mju_bangmok_campus_1794821245874.jpg',
};

export async function seedInitialWorkspaceData(adminUid: string, adminName: string) {
  try {
    const batch = writeBatch(db);
    let hasWrites = false;

    const publicSettingsRef = doc(db, 'settings', 'public');
    const publicSnap = await getDoc(publicSettingsRef);
    if (!publicSnap.exists()) {
      batch.set(publicSettingsRef, {
        ...DEFAULT_PUBLIC_SETTINGS,
        updatedAt: serverTimestamp(),
      });
      hasWrites = true;
    }

    const communityLinksRef = doc(db, 'settings', 'communityLinks');
    const linksSnap = await getDoc(communityLinksRef);
    if (!linksSnap.exists()) {
      batch.set(communityLinksRef, {
        mainChatTitle: '명지대 청소년지도학과 원우회 공식 오픈채팅방',
        mainChatUrl: 'https://open.kakao.com/o/mju-youth-council-demo',
        mainChatPasscode: 'mju2026',
        studyChatTitle: '대학원 논문·연구방법론 스터디방',
        studyChatUrl: 'https://open.kakao.com/o/mju-youth-study-demo',
        roomRules:
          '1. 원우회 승인 회원만 참여 가능하며, 입장 후 [기수/과정/이름] 형식으로 닉네임을 설정해 주세요.\n2. 학술 정보·세미나·학사 일정 공유를 우선하며, 외부 비인가자 초대 및 영리 목적 홍보는 제한됩니다.',
        updatedAt: serverTimestamp(),
      });
      hasWrites = true;
    }

    const activitiesSnap = await getDocs(query(collection(db, 'activities'), limit(1)));
    if (activitiesSnap.empty) {
      const seedActivities = [
        {
          id: 'activity-2026-colloquium',
          title: '2026학년도 후기 학술 콜로퀴엄 및 질적·양적 연구방법론 특강',
          category: '학술·세미나',
          eventDate: '2026.11.28 (토) 14:00',
          location: '인문캠퍼스 본관 세미나실 302호',
          summary:
            '석·박사 과정 원우들의 학위논문 설계 역량을 높이기 위해 청소년학 최신 연구방법론 특강과 선배 원우 논문 발표를 진행합니다.',
          content:
            '명지대학교 대학원 청소년지도학과 원우회에서 주관하는 2026학년도 후기 학술 콜로퀴엄에 원우 여러분을 초대합니다.\n\n1부에서는 청소년 패널데이터(KCYPS) 활용 구조방정식 모델링과 질적 사례연구(포토보이스·근거이론) 설계 핵심 포인트를 다루며, 2부에서는 박사과정 및 수료 원우들의 학술지 게재 사례를 공유하고 질의응답 시간을 갖습니다.\n\n행사 종료 후에는 인근에서 다과와 함께 연구 관심사별 네트워킹 모임이 이어집니다.',
          imageUrl: ACTIVITY_PRESET_IMAGES[2].url,
          isPublished: true,
        },
        {
          id: 'activity-2026-fieldtrip',
          title: '수도권 청소년문화의집 및 디지털미디어센터 현장 탐방',
          category: '현장 탐방',
          eventDate: '2026.12.05 (토) 10:30',
          location: '서울시립청소년문화교류센터 일대',
          summary:
            '청소년수련시설 현장의 최신 프로그램 운영 사례와 지역사회 연계 체계를 직접 살피고 실무 지도자들과 간담회를 진행합니다.',
          content:
            '이론과 현장의 간극을 좁히기 위해 매 학기 운영하는 원우회 현장 탐방 프로그램입니다.\n\n이번 학기에는 청소년 참여자치기구 운영 우수 기관과 디지털 리터러시 특화 시설을 방문하여 기관장 및 청소년지도사 실무진과의 라운드테이블을 진행할 예정입니다.\n\n참여를 희망하는 원우께서는 회원 전용 게시판 또는 카카오톡 오픈채팅방 공지를 통해 사전 신청해 주세요.',
          imageUrl: ACTIVITY_PRESET_IMAGES[3].url,
          isPublished: true,
        },
        {
          id: 'activity-2026-orientation',
          title: '2026학년도 신·편입생 환영 오리엔테이션 및 수강·학사 안내',
          category: '원우 교류',
          eventDate: '2026.09.05 (토) 11:00',
          location: '인문캠퍼스 종합관 10층 대강당',
          summary:
            '새롭게 입학한 석·박사 원우들을 환영하며 학사 이수 로드맵, 지도교수 매칭, 원우회 연간 사업 계획을 소개한 행사입니다.',
          content:
            '2026학년도 새롭게 합류한 신·편입생 원우님들을 진심으로 환영합니다.\n\n오리엔테이션에서는 졸업 이수학점, 외국어·종합시험 일정, 학술지 등재 요건 등 대학원 생활에 꼭 필요한 실무 정보를 정리한 웰컴 가이드를 배부하고, 재학생 선배들과의 멘토링 조 편성을 진행했습니다.',
          imageUrl: ACTIVITY_PRESET_IMAGES[1].url,
          isPublished: true,
        },
      ];

      for (const item of seedActivities) {
        batch.set(doc(db, 'activities', item.id), {
          title: item.title,
          category: item.category,
          eventDate: item.eventDate,
          location: item.location,
          summary: item.summary,
          content: item.content,
          imageUrl: item.imageUrl,
          isPublished: item.isPublished,
          authorUid: adminUid,
          authorName: adminName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      hasWrites = true;
    }

    const boardSnap = await getDocs(query(collection(db, 'boardPosts'), limit(1)));
    if (boardSnap.empty) {
      const seedPosts = [
        {
          id: 'post-welcome-notice',
          title: '[공지] 제18대 청소년지도학과 원우회 커뮤니티 오픈 및 이용 안내',
          category: '공지사항',
          content:
            '안녕하세요, 제18대 명지대학교 대학원 청소년지도학과 원우회입니다.\n\n원우님들 간의 학술 교류와 긴밀한 소통을 위해 원우회 전용 커뮤니티 웹페이지를 개설했습니다.\n- 회원 전용 게시판: 원우회 공식 공지, 논문·통계 스터디 모집, 학사 Q&A\n- 연구 동향 아카이브: 청소년 정책·상담·미디어 최신 보고서와 논문 요약 공유\n- 카카오톡 라운지: 원우회 공식 오픈채팅방 바로가기 및 참여코드 확인\n\n모든 원우님들의 적극적인 참여를 부탁드립니다.',
          isPinned: true,
          recruitStatus: '해당없음',
          studySchedule: '',
        },
        {
          id: 'post-study-spss-amos',
          title: '2026-2학기 SPSS·AMOS 구조방정식 논문통계 스터디 원우 모집',
          category: '스터디 모집',
          content:
            '석사·박사 학위논문 및 학술지 투고를 준비하는 원우님들과 함께 양적 연구방법론 스터디를 진행하고자 합니다.\n\n[진행 방식]\n- 한국아동·청소년패널조사(KCYPS) 실데이터 활용 실습\n- 탐색적/확인적 요인분석, 매개·조절효과(PROCESS Macro), 다층모형 기초\n- 매주 1회 발표 및 피드백 (최대 6인 소수 정예)\n\n관심 있는 원우님께서는 댓글로 과정/이름/관심 주제를 남겨주세요!',
          isPinned: false,
          recruitStatus: '모집중',
          studySchedule: '매주 목요일 20:00 · 온라인 Zoom',
        },
        {
          id: 'post-qa-ethics-irb',
          title: '질적 연구 IRB 심의 신청 시 미성년자 보호자 동의서 작성 팁 문의',
          category: '학사·논문 Q&A',
          content:
            '학교 밖 청소년 대상 심층면담 연구를 준비하면서 교내 생명윤리위원회(IRB) 심의 서류를 작성 중입니다.\n\n보호자 동의를 직접 받기 어려운 사례의 경우 대리동의 면제 사유서나 현장 기관 협조 공문을 어떻게 구성하셨는지 선배 원우님들의 경험 공유를 부탁드립니다.',
          isPinned: false,
          recruitStatus: '해당없음',
          studySchedule: '',
        },
      ];

      for (const post of seedPosts) {
        batch.set(doc(db, 'boardPosts', post.id), {
          title: post.title,
          category: post.category,
          content: post.content,
          isPinned: post.isPinned,
          recruitStatus: post.recruitStatus,
          ...(post.studySchedule ? { studySchedule: post.studySchedule } : {}),
          authorUid: adminUid,
          authorName: adminName,
          authorCohort: '원우회 집행부',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      hasWrites = true;
    }

    const trendsSnap = await getDocs(query(collection(db, 'researchTrends'), limit(1)));
    if (trendsSnap.empty) {
      const seedTrends = [
        {
          id: 'trend-youth-policy-2026',
          title: '제7차 청소년정책 기본계획 중간점검 및 디지털 전환기 청소년 활동 패러다임',
          category: '청소년정책·제도',
          source: '한국청소년정책연구원 (NYPI)',
          publishedPeriod: '2026.10',
          externalUrl: 'https://www.nypi.re.kr',
          summary:
            '지역사회 기반 청소년 활동 공간의 기능 재편과 AI·메타버스 환경에서의 청소년 참여권 확대 방안을 다룬 정책 브리프입니다. 특히 인구감소지역 청소년수련시설의 거점화 모델과 학교-지역 연계 돌봄·활동 통합지원 지표가 핵심적으로 제시되었습니다.',
          keyTakeaway:
            '수련시설 중심의 물리적 프로그램에서 벗어나 학교밖·온라인 참여 거버넌스와 청소년지도사의 디지털 촉진자(Facilitator) 역량이 핵심 정책 과제로 부상하고 있습니다.',
          isPinned: true,
        },
        {
          id: 'trend-digital-wellbeing',
          title: '청소년의 생성형 AI 및 숏폼 미디어 이용과 정서적 고립감 간의 종단적 관계',
          category: '디지털·미디어',
          source: '한국청소년연구 제37권 제3호',
          publishedPeriod: '2026.09',
          externalUrl: 'https://www.dbpia.co.kr',
          summary:
            '고위험 숏폼 과의존 집단과 생성형 AI를 정서적 대화 상대로 활용하는 청소년 집단의 심리사회적 적응 차이를 자기회귀교차지연모형(ARCL)으로 검증한 최신 논문입니다. 단순 이용시간보다 이용 동기와 오프라인 사회적 지지 수준이 핵심 조절변인으로 확인되었습니다.',
          keyTakeaway:
            '미디어 리터러시 교육과 함께 정서적 대인관계 효능감을 보완하는 집단지도 프로그램 설계의 실증적 근거로 활용하기 좋습니다.',
          isPinned: false,
        },
        {
          id: 'trend-isolated-youth-support',
          title: '은둔·고립 청소년 및 가족돌봄청년(영케어러) 맞춤형 통합사례관리 가이드라인',
          category: '상담·심리지원',
          source: '여성가족부 · 한국청소년상담복지개발원',
          publishedPeriod: '2026.08',
          externalUrl: 'https://www.kyci.or.kr',
          summary:
            '청소년안전망과 지자체 고립·은둔 청년 지원사업 간의 연계 사각지대를 해소하기 위해 마련된 통합 사례관리 매뉴얼입니다. 초기 아웃리치 전략, 비대면 초기상담 라포 형성 절차, 가족 단위 지원 연계 기준을 구체적으로 정리했습니다.',
          keyTakeaway:
            '청소년기와 성인기 이행기(18~24세) 경계 대상자에 대한 연속적 사례관리 체계가 향후 논문 및 현장 실무의 주요 쟁점입니다.',
          isPinned: false,
        },
      ];

      for (const trend of seedTrends) {
        batch.set(doc(db, 'researchTrends', trend.id), {
          title: trend.title,
          category: trend.category,
          source: trend.source,
          publishedPeriod: trend.publishedPeriod,
          externalUrl: trend.externalUrl,
          summary: trend.summary,
          keyTakeaway: trend.keyTakeaway,
          isPinned: trend.isPinned,
          authorUid: adminUid,
          authorName: adminName,
          authorCohort: '원우회 집행부',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      hasWrites = true;
    }

    if (hasWrites) {
      await batch.commit();
    }
    return hasWrites;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seedInitialWorkspaceData');
  }
}
