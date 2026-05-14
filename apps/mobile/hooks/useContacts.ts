import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";

export interface Contact {
  name: string;
  address: string;
}

const QUERY_KEY = ["contacts"] as const;

export function useContacts() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const stored = await StorageService.getItem<Contact[]>(
        AUTH_STORAGE_KEYS.ADDRESS_BOOK
      );
      return stored ?? [];
    },
    staleTime: Infinity,
  });

  const addMutation = useMutation({
    mutationFn: async (contact: Contact) => {
      const current =
        (await StorageService.getItem<Contact[]>(
          AUTH_STORAGE_KEYS.ADDRESS_BOOK
        )) ?? [];
      const next = [...current, contact];
      await StorageService.setItem(AUTH_STORAGE_KEYS.ADDRESS_BOOK, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (address: string) => {
      const current =
        (await StorageService.getItem<Contact[]>(
          AUTH_STORAGE_KEYS.ADDRESS_BOOK
        )) ?? [];
      const next = current.filter((c) => c.address !== address);
      await StorageService.setItem(AUTH_STORAGE_KEYS.ADDRESS_BOOK, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
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
      const current =
        (await StorageService.getItem<Contact[]>(
          AUTH_STORAGE_KEYS.ADDRESS_BOOK
        )) ?? [];
      const next = current.map((c) =>
        c.address === originalAddress ? contact : c
      );
      await StorageService.setItem(AUTH_STORAGE_KEYS.ADDRESS_BOOK, next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
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
