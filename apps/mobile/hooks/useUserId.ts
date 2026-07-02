import { useAuth } from "@/contexts/AuthContext";

/** The backend user id, used as a cache-key dimension for per-user queries. */
export function useUserId(): string | null {
  const { user } = useAuth();
  return user?.id ?? null;
}
