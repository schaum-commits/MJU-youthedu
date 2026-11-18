import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutUser,
} from '../lib/firebase';
import { seedInitialWorkspaceData } from '../lib/seedData';
import {
  AcademicStatus,
  BOOTSTRAPPED_ADMIN_EMAIL,
  DegreeProgram,
  LIMITS,
  UserProfile,
} from '../types/community';

interface ApplicationPayload {
  displayName: string;
  cohort: string;
  program: DegreeProgram;
  academicStatus: AcademicStatus;
  studentId: string;
  researchInterest: string;
  applicationNote: string;
}

interface AuthContextValue {
  authUser: User | null;
  authReady: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  isAdmin: boolean;
  isApprovedMember: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  submitApplication: (payload: ApplicationPayload) => Promise<void>;
  updateMyProfile: (payload: ApplicationPayload) => Promise<void>;
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [hasAdminDoc, setHasAdminDoc] = useState(false);
  const [hasMemberPublicDoc, setHasMemberPublicDoc] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const bootstrappedRef = useRef<string | null>(null);
  const migratedCohortRef = useRef<string | null>(null);

  const isBootstrappedAdmin = Boolean(
    authUser?.emailVerified && authUser?.email === BOOTSTRAPPED_ADMIN_EMAIL
  );
  const isAdmin = isBootstrappedAdmin || hasAdminDoc;
  const isApprovedMember = isAdmin || hasMemberPublicDoc;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setHasAdminDoc(false);
        setHasMemberPublicDoc(false);
        setProfileLoading(false);
      } else {
        setProfileLoading(true);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) return;

    const uid = authUser.uid;
    let userLoaded = false;
    let adminLoaded = false;
    let memberLoaded = false;

    const checkAllLoaded = () => {
      if (userLoaded && adminLoaded && memberLoaded) {
        setProfileLoading(false);
      }
    };

    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      async (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          if (
            data.cohort === '제18대 원우회' &&
            authUser.emailVerified &&
            authUser.email === BOOTSTRAPPED_ADMIN_EMAIL &&
            migratedCohortRef.current !== uid
          ) {
            migratedCohortRef.current = uid;
            setProfile({ ...data, cohort: '2026학년도 1학기' });
            try {
              const batch = writeBatch(db);
              batch.update(doc(db, 'users', uid), {
                cohort: '2026학년도 1학기',
                updatedAt: serverTimestamp(),
              });
              batch.update(doc(db, 'membersPublic', uid), {
                cohort: '2026학년도 1학기',
                updatedAt: serverTimestamp(),
              });
              await batch.commit();
            } catch {
              // Ignore if membersPublic does not exist yet
            }
          } else {
            setProfile(data);
          }
        } else {
          setProfile(null);
          if (
            authUser.emailVerified &&
            authUser.email === BOOTSTRAPPED_ADMIN_EMAIL &&
            bootstrappedRef.current !== uid
          ) {
            bootstrappedRef.current = uid;
            try {
              const displayName = (authUser.displayName || '원우회 관리자').slice(
                0,
                LIMITS.displayName
              );
              const batch = writeBatch(db);
              batch.set(doc(db, 'users', uid), {
                uid,
                email: authUser.email,
                displayName,
                cohort: '2026학년도 1학기',
                program: '석사과정',
                academicStatus: '재학',
                studentId: 'ADMIN-MJU',
                researchInterest: '청소년지도 및 정책 연구',
                applicationNote: '원우회 관리자 계정 자동 인증',
                status: 'approved',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              batch.set(doc(db, 'membersPublic', uid), {
                uid,
                displayName,
                cohort: '2026학년도 1학기',
                program: '석사과정',
                academicStatus: '재학',
                researchInterest: '청소년지도 및 정책 연구',
                roleTitle: '원우회 관리자',
                updatedAt: serverTimestamp(),
              });
              await batch.commit();
              await seedInitialWorkspaceData(uid, displayName);
            } catch (err) {
              console.error('Admin bootstrap error:', err);
            }
          }
        }
        userLoaded = true;
        checkAllLoaded();
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${uid}`);
      }
    );

    const unsubAdmin = onSnapshot(
      doc(db, 'admins', uid),
      (snap) => {
        setHasAdminDoc(snap.exists());
        adminLoaded = true;
        checkAllLoaded();
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `admins/${uid}`);
      }
    );

    const unsubMemberPublic = onSnapshot(
      doc(db, 'membersPublic', uid),
      (snap) => {
        setHasMemberPublicDoc(snap.exists());
        memberLoaded = true;
        checkAllLoaded();
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `membersPublic/${uid}`);
      }
    );

    return () => {
      unsubUser();
      unsubAdmin();
      unsubMemberPublic();
    };
  }, [authReady, authUser]);

  const loginWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '로그인 중 오류가 발생했습니다.';
      if (msg.includes('unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : '현재 도메인';
        setAuthError(
          `현재 도메인(${host})이 Firebase 인증 허용 도메인에 등록되지 않았습니다. Firebase Console → Authentication → Settings → Authorized domains에 ${host}을(를) 추가해 주세요.`
        );
      } else if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Google 로그인에 실패했습니다. 팝업 차단을 해제한 뒤 다시 시도해 주세요.');
      }
    }
  };

  const logout = async () => {
    await signOutUser();
  };

  const submitApplication = async (payload: ApplicationPayload) => {
    if (!authUser || !authUser.email) {
      throw new Error('로그인이 필요합니다.');
    }
    const uid = authUser.uid;
    const status = isAdmin ? 'approved' : 'pending';
    const userPath = `users/${uid}`;
    try {
      await setDoc(doc(db, 'users', uid), {
        uid,
        email: authUser.email.slice(0, 160),
        displayName: payload.displayName.trim().slice(0, LIMITS.displayName),
        cohort: payload.cohort.trim().slice(0, LIMITS.cohort),
        program: payload.program,
        academicStatus: payload.academicStatus,
        studentId: payload.studentId.trim().slice(0, LIMITS.studentId),
        researchInterest: payload.researchInterest.trim().slice(0, LIMITS.researchInterest),
        applicationNote: payload.applicationNote.trim().slice(0, LIMITS.applicationNote),
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  };

  const updateMyProfile = async (payload: ApplicationPayload) => {
    if (!authUser) throw new Error('로그인이 필요합니다.');
    const uid = authUser.uid;
    const cleanName = payload.displayName.trim().slice(0, LIMITS.displayName);
    const cleanCohort = payload.cohort.trim().slice(0, LIMITS.cohort);
    const cleanInterest = payload.researchInterest.trim().slice(0, LIMITS.researchInterest);

    try {
      await updateDoc(doc(db, 'users', uid), {
        displayName: cleanName,
        cohort: cleanCohort,
        program: payload.program,
        academicStatus: payload.academicStatus,
        studentId: payload.studentId.trim().slice(0, LIMITS.studentId),
        researchInterest: cleanInterest,
        applicationNote: payload.applicationNote.trim().slice(0, LIMITS.applicationNote),
        updatedAt: serverTimestamp(),
      });

      if (hasMemberPublicDoc) {
        await updateDoc(doc(db, 'membersPublic', uid), {
          displayName: cleanName,
          cohort: cleanCohort,
          program: payload.program,
          academicStatus: payload.academicStatus,
          researchInterest: cleanInterest,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authUser,
        authReady,
        profile,
        profileLoading,
        isAdmin,
        isApprovedMember,
        loginWithGoogle,
        logout,
        submitApplication,
        updateMyProfile,
        authError,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
