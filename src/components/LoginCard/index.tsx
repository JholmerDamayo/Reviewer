import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { useAuth } from '../../context/AuthContext';

type LoginCardProps = {
  onSuccess: () => void;
};

function LoginCard({ onSuccess }: LoginCardProps) {
  const { attemptLogin, rememberedCredentials } = useAuth();
  const [username, setUsername] = useState(rememberedCredentials?.username ?? '');
  const [password, setPassword] = useState(rememberedCredentials?.password ?? '');
  const [rememberPassword, setRememberPassword] = useState(Boolean(rememberedCredentials));
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!shake) {
      return;
    }

    const timeout = window.setTimeout(() => setShake(false), 420);
    return () => window.clearTimeout(timeout);
  }, [shake]);

  function spawnRipple(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    const ripple = document.createElement('span');
    ripple.className = 'button-ripple';
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;
    const rect = button.getBoundingClientRect();

    ripple.style.width = ripple.style.height = `${diameter}px`;
    ripple.style.left = `${event.clientX - rect.left - radius}px`;
    ripple.style.top = `${event.clientY - rect.top - radius}px`;

    const oldRipple = button.querySelector('.button-ripple');
    if (oldRipple) {
      oldRipple.remove();
    }

    button.appendChild(ripple);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const isValid = await attemptLogin(username, password, rememberPassword);

    window.setTimeout(() => {
      setLoading(false);

      if (!isValid) {
        setError('Incorrect credentials. Try student / review123.');
        setShake(true);
        return;
      }

      onSuccess();
    }, 850);
  }

  return (
    <div className={`login-card glass-panel page-enter ${shake ? 'shake-card' : ''}`}>
      <div className="logo-badge" aria-hidden="true">
        <span>R</span>
      </div>

      <div className="login-heading">
        <h1>ReviewerOS</h1>
        <p>Your Intelligent Study Companion</p>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <label className="field-shell">
          <span className="field-icon" aria-hidden="true">
            👤
          </span>
          <input
            autoComplete="username"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            type="text"
            value={username}
          />
        </label>

        <label className="field-shell">
          <span className="field-icon" aria-hidden="true">
            🔐
          </span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
          />
          <button
            className="eye-toggle"
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </label>

        <label className="remember-row">
          <span>Remember Password</span>
          <span className="toggle-shell">
            <input
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
              type="checkbox"
            />
            <span className="toggle-track" />
          </span>
        </label>

        <button
          className={`login-button ${loading ? 'is-loading' : ''}`}
          onClick={spawnRipple}
          type="submit"
        >
          {loading ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              <span>Signing In</span>
            </>
          ) : (
            <span>Enter ReviewerOS</span>
          )}
        </button>

        <p className={`login-error ${error ? 'visible' : ''}`}>{error || ' '}</p>
      </form>
    </div>
  );
}

export default LoginCard;
