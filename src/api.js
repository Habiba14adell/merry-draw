import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null

export async function rpc(name, params) {
  if (!supabase) throw new Error('Connect Supabase using the project setup instructions.')
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}

export const admin = (action, id, payload) => rpc('merry_admin', {
  p_action: action, p_id: id ?? null, p_data: payload ?? {},
})
