import { useState } from 'react'
import Login from './components/Login.jsx'
import Dashboard from './components/Dashboard.jsx'

export default function App() {
  const [authed, setAuthed] = useState(false)

  if (!authed) return <Login onLogin={() => setAuthed(true)} />
  return <Dashboard onLogout={() => setAuthed(false)} />
}
