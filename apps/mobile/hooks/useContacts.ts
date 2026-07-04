import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StorageService, userScopedKey } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { useUserId } from "@/hooks/useUserId";

export interface Contact {
  name: string;
  address: string;
}

// Scoped to the signed-in user so switching accounts on one device keeps each
// person's address book separate — and intact when they sign back in.
function addressBookKey(userId: string) {
  return userScopedKey(AUTH_STORAGE_KEYS.ADDRESS_BOOK, userId);
}

export function useContacts() {
  const queryClient = useQueryClient();
  const userId = useUserId();
  const queryKey = ["contacts", userId] as const;
  const storageKey = userId ? addressBookKey(userId) : null;

  const query = useQuery({
    queryKey,
    enabled: !!storageKey,
    queryFn: async () => {
      if (!storageKey) return [];
      const stored = await StorageService.getItem<Contact[]>(storageKey);
      return stored ?? [];
    },
    staleTime: Infinity,
  });

  const addMutation = useMutation({
    mutationFn: async (contact: Contact) => {
      if (!storageKey) return [];
      const current =
        (await StorageService.getItem<Contact[]>(storageKey)) ?? [];
      const next = [...current, contact];
      await StorageService.setItem(storageKey, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (address: string) => {
      if (!storageKey) return [];
      const current =
        (await StorageService.getItem<Contact[]>(storageKey)) ?? [];
      const next = current.filter((c) => c.address !== address);
      await StorageService.setItem(storageKey, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      originalAddress,
      contact,
    }: {
      originalAddress: string;
      contact: Contact;
    }) => {
      if (!storageKey) return [];
      const current =
        (await StorageService.getItem<Contact[]>(storageKey)) ?? [];
      const next = current.map((c) =>
        c.address === originalAddress ? contact : c
      );
      await StorageService.setItem(storageKey, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
    },
  });

  return {
    contacts: query.data ?? [],
    addContact: addMutation.mutate,
    removeContact: removeMutation.mutate,
    updateContact: updateMutation.mutate,
    isLoading: query.isLoading,
  };
}
