import { MerchantProfileUpdate } from './profile.dtos';
const valid = {
  expectedVersion: 0,
  displayName: 'Chowderr',
  profile: {
    legalName: '',
    contactName: '',
    contactEmail: '',
    phone: '',
    website: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  },
};
describe('Merchant profile payload', () => {
  it('accepts an initially empty contact profile', () => {
    expect(MerchantProfileUpdate.safeParse(valid).success).toBe(true);
  });
  it.each([
    'ownerProviderId',
    'receivingWallet',
    'kybStatus',
    'flatFeeBps',
    'signInEmail',
  ])('rejects protected field %s', (field) => {
    expect(
      MerchantProfileUpdate.safeParse({ ...valid, [field]: 'changed' }).success,
    ).toBe(false);
  });
  it('rejects invalid email, unsafe website schemes and missing versions', () => {
    expect(
      MerchantProfileUpdate.safeParse({
        ...valid,
        profile: { ...valid.profile, contactEmail: 'bad' },
      }).success,
    ).toBe(false);
    expect(
      MerchantProfileUpdate.safeParse({
        ...valid,
        profile: { ...valid.profile, website: 'javascript:alert(1)' },
      }).success,
    ).toBe(false);
    expect(
      MerchantProfileUpdate.safeParse({ ...valid, expectedVersion: undefined })
        .success,
    ).toBe(false);
  });
});
