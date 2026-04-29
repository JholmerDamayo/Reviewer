import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getStudentAccountByCredentials, type StudentAccount } from '../lib/supabase';

type RememberedCredentials = {
  username: string;
  password: string;
};

type StudentUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  initials: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  user: StudentUser;
  rememberedCredentials: RememberedCredentials | null;
  attemptLogin: (
    username: string,
    password: string,
    remember: boolean
  ) => Promise<boolean>;
  completeLogin: () => void;
  signOut: () => void;
};

const EMPTY_USER: StudentUser = {
  id: '',
  username: '',
  name: 'Alex Rivera',
  role: 'Student',
  initials: 'AR'
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapStudentAccountToUser(account: StudentAccount): StudentUser {
  return {
    id: account.id,
    username: account.username,
    name: account.display_name,
    role: account.role,
    initials: account.initials
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<StudentUser>(EMPTY_USER);
  const [rememberedCredentials, setRememberedCredentials] =
    useLocalStorage<RememberedCredentials | null>('reviewer-os-remembered', null);

  async function attemptLogin(username: string, password: string, remember: boolean) {
    let account = null;

    try {
      account = await getStudentAccountByCredentials(username, password);
    } catch {
      setUser(EMPTY_USER);
      return false;
    }

    if (!account) {
      setUser(EMPTY_USER);
      return false;
    }

    if (remember) {
      setRememberedCredentials({
        username,
        password
      });
    } else {
      setRememberedCredentials(null);
    }

    setUser(mapStudentAccountToUser(account));
    return true;
  }

  function completeLogin() {
    setIsAuthenticated(true);
  }

  function signOut() {
    setIsAuthenticated(false);
    setUser(EMPTY_USER);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      user,
      rememberedCredentials,
      attemptLogin,
      completeLogin,
      signOut
    }),
    [isAuthenticated, rememberedCredentials, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
