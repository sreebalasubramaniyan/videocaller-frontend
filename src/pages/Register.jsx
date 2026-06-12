import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const { register, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await register(username, email, password);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const displayError = localError || error;

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="material-icons-outlined meet-icon-colored" style={{ fontSize: '2.5rem' }}>videocam</span>
            <span>Google <span className="meet-icon-colored">Meet</span></span>
          </div>
          <h2>Create account</h2>
          <p>to get started with video meetings</p>
        </div>

        {displayError && (
          <div className="error-message">
            <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>error_outline</span>
            {displayError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="text"
              placeholder=" "
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              id="register-username"
            />
            <label htmlFor="register-username">Username</label>
          </div>

          <div className="input-group">
            <input
              type="email"
              placeholder=" "
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              id="register-email"
            />
            <label htmlFor="register-email">Email address</label>
          </div>

          <div className="input-group">
            <input
              type="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              id="register-password"
            />
            <label htmlFor="register-password">Password</label>
          </div>

          <div className="input-group">
            <input
              type="password"
              placeholder=" "
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              id="register-confirm"
            />
            <label htmlFor="register-confirm">Confirm password</label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Submit'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in instead</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;