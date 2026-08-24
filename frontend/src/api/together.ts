import api from './client';
import type { RecommendationResponse } from '../types/recommendation';
import type { MoodType, TimeSlot } from '../types/mood';

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
  api.post<JoinResult>('/api/together/rooms', { name, favourite_ids });

export const joinRoom = (code: string, name: string, favourite_ids: string[]) =>
  api.post<JoinResult>(`/api/together/rooms/${code}/join`, { name, favourite_ids });

export const getRoom = (code: string) =>
  api.get<RoomState>(`/api/together/rooms/${code}`);

export const roomPick = (code: string, mood: MoodType, time_available: TimeSlot) =>
  api.post<RecommendationResponse>(`/api/together/rooms/${code}/pick`, { mood, time_available });
