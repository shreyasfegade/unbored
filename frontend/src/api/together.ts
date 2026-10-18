import type { RecommendationResponse } from '../types/recommendation';
import type { MoodType, TimeSlot } from '../types/mood';
import { request } from './client';

export interface MemberView {
  id: string;
  name: string;
  favourite_count: number;
}

export interface RoomState {
  code: string;
  members: MemberView[];
  combined_favourites: number;
  expires_in: number;
}

export interface JoinResult {
  member_id: string;
  room: RoomState;
}

export const createRoom = (name: string, favourite_ids: string[]) =>
  request<JoinResult>('POST', '/api/together/rooms', { body: { name, favourite_ids }, timeoutMs: 90000 });

export const joinRoom = (code: string, name: string, favourite_ids: string[]) =>
  request<JoinResult>('POST', `/api/together/rooms/${code}/join`, { body: { name, favourite_ids }, timeoutMs: 90000 });

export const getRoom = (code: string) =>
  request<RoomState>('GET', `/api/together/rooms/${code}`, { timeoutMs: 90000 });

export const roomPick = (code: string, mood: MoodType, time_available: TimeSlot) =>
  request<RecommendationResponse>('POST', `/api/together/rooms/${code}/pick`, {
    body: { mood, time_available },
    timeoutMs: 90000,
  });
