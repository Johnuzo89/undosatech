import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })
    if (error) console.error('Login error:', error.message)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <h1>UndosaTech</h1>
      <p>Federated Learning for Medical Research</p>
      <button onClick={handleGoogleLogin}>
        Sign in with Google
      </button>
    </div>
  )
}
