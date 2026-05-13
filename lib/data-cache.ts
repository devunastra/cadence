import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from './supabase/server'
import type { Studio } from './types'

// React cache() deduplicates calls within the same server request.

// Uses getSession() (no network call) because the middleware already validated
// the token with getUser(). Safe to trust the cookie here.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getMemberships = cache(async (userId: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('studio_users')
    .select('studio_id, role')
    .eq('user_id', userId)
  return data ?? []
})

export const getSelectedStudioId = cache(async () => {
  const cookieStore = await cookies()
  return cookieStore.get('selected_studio_id')?.value ?? null
})

export const getStudios = cache(async (isSuper: boolean, studioIds: string[]) => {
  if (isSuper) {
    const serviceClient = createServiceClient()
    const { data } = await serviceClient.from('studios').select('*').is('deleted_at', null).order('name')
    return (data ?? []) as Studio[]
  }
  const supabase = await createClient()
  const { data } = await supabase.from('studios').select('*').in('id', studioIds).is('deleted_at', null).order('name')
  return (data ?? []) as Studio[]
})
