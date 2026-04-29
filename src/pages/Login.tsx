import LoginCard from '../components/LoginCard';

type LoginProps = {
  onSuccess: () => void;
};

function Login({ onSuccess }: LoginProps) {
  return (
    <section className="login-screen">
      <div className="login-copy page-enter">
        <span className="eyebrow">Adaptive Review Platform</span>
        <h2>Study intelligence with a cinematic workflow.</h2>
        <p>
          Sign in with the demo credentials to enter a dashboard designed for
          focused practice, analytics, and exam readiness.
        </p>
      </div>

      <LoginCard onSuccess={onSuccess} />
    </section>
  );
}

export default Login;
