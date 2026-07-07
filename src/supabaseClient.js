import { createClient } from '@supabase/supabase-js'

// ── Supabase connection ──
// The anon key is safe to expose in frontend code — your Row-Level Security
// rules are what actually protect the data. (Can move to env vars later.)
const SUPABASE_URL = 'https://llnweyexrqpygpmrqgfr.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsbndleWV4cnFweWdwbXJxZ2ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjIzNjAsImV4cCI6MjA5ODk5ODM2MH0.v5S9RmFgQf5_7_JM6sYMTrd-gcc6tXnlyGIAibG86gg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth helpers ──

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// Load the logged-in user's profile row (role + display name)
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}
