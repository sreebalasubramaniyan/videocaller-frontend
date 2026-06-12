import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="material-icons-outlined meet-icon-colored" style={{ fontSize: '2.5rem' }}>videocam</span>
            <span>Google <span className="meet-icon-colored">Meet</span></span>
          </div>
          <h2>Sign in</h2>
          <p>to continue to Google Meet</p>
        </div>

        {error && (
          <div className="error-message">
            <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>error_outline</span>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="email"
              placeholder=" "
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              id="login-email"
            />
            <label htmlFor="login-email">Email address</label>
          </div>

          <div className="input-group">
            <input
              type="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              id="login-password"
            />
            <label htmlFor="login-password">Password</label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Next'}
          </button>
        </form>

        <div className="auth-footer">
          Don't have an account? <Link to="/register">Create account</Link>
        </div>
      </div>
    </div>
  );
};

export default Login;