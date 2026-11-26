//! Shared, stateless bridge from a precise Account token allowance to lending.
//! No signer is added to the Account. Every output and unspent input returns
//! to its vault before success. The outer transaction grants and revokes the
//! allowance under the existing two-signature policy.
#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    program_pack::Pack,
    pubkey,
    pubkey::Pubkey,
};
use spl_token::state::{Account, Mint};

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const KAMINO: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const JUPITER: Pubkey = pubkey!("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
const K_DEPOSIT: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
const K_REDEEM: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];
const J_DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
const J_REDEEM: [u8; 8] = [184, 12, 86, 149, 70, 196, 97, 225];

// Wire v1: version, provider (0 Kamino / 1 Jupiter), action (0 deposit / 1 redeem),
// raw input u64, minimum output u64. Provider instruction is built here, not accepted as bytes.
fn terms(data: &[u8]) -> Result<(u8, u8, u64, u64), ProgramError> {
    if data.len() != 19 || data[0] != 1 || data[1] > 1 || data[2] > 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[3..11].try_into().unwrap());
    let minimum = u64::from_le_bytes(data[11..19].try_into().unwrap());
    if amount == 0 || amount == u64::MAX || minimum == 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok((data[1], data[2], amount, minimum))
}
const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
// Token-2022 keeps the classic layout as a prefix; extensions follow an
// account-type byte at offset 165 (1 = mint, 2 = token account).
fn base<'a>(
    info: &AccountInfo,
    data: &'a [u8],
    len: usize,
    kind: u8,
) -> Result<&'a [u8], ProgramError> {
    if info.owner == &spl_token::id() && data.len() == len {
        return Ok(data);
    }
    if info.owner == &TOKEN_2022
        && (data.len() == len || (data.len() > Account::LEN && data[Account::LEN] == kind))
    {
        return Ok(&data[..len]);
    }
    Err(ProgramError::IllegalOwner)
}
fn token(info: &AccountInfo) -> Result<Account, ProgramError> {
    let data = info.try_borrow_data()?;
    Account::unpack(base(info, &data, Account::LEN, 2)?)
}
fn mint(info: &AccountInfo) -> Result<Mint, ProgramError> {
    let data = info.try_borrow_data()?;
    Mint::unpack(base(info, &data, Mint::LEN, 1)?)
}
fn same(a: &Pubkey, b: &Pubkey) -> ProgramResult {
    if a != b {
        Err(ProgramError::InvalidAccountData)
    } else {
        Ok(())
    }
}

pub fn process_instruction(
    program: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let (provider, action, amount, minimum) = terms(data)?;
    if accounts.len() < 11 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let [payer, vault, authority, asset, receipt, source, destination, staging_in, staging_out, token_program, venue, ..] =
        accounts
    else {
        unreachable!()
    };
    if !payer.is_signer || vault.is_signer || !venue.executable {
        return Err(ProgramError::InvalidAccountData);
    }
    if token_program.key != &spl_token::id() && token_program.key != &TOKEN_2022 {
        return Err(ProgramError::IncorrectProgramId);
    }
    // Kamino stays pinned to USDC. Jupiter derives its lending and receipt
    // accounts from the asset mint, so any listed main-market asset is safe here.
    if provider == 0 {
        same(asset.key, &USDC)?;
    }
    same(asset.owner, token_program.key)?;
    same(receipt.owner, token_program.key)?;
    same(venue.key, if provider == 0 { &KAMINO } else { &JUPITER })?;
    if asset.key == receipt.key {
        return Err(ProgramError::InvalidAccountData);
    }
    let (expected, bump) = Pubkey::find_program_address(&[b"earn", vault.key.as_ref()], program);
    same(authority.key, &expected)?;
    let bump_bytes = [bump];
    let seeds: &[&[u8]] = &[b"earn", vault.key.as_ref(), &bump_bytes];
    let (input_mint, output_mint) = if action == 0 {
        (asset, receipt)
    } else {
        (receipt, asset)
    };
    let input_decimals = mint(input_mint)?.decimals;
    let output_decimals = mint(output_mint)?.decimals;
    let input = token(source)?;
    let output = token(destination)?;
    same(&input.owner, vault.key)?;
    same(&output.owner, vault.key)?;
    same(&input.mint, input_mint.key)?;
    same(&output.mint, output_mint.key)?;
    if input.delegate != solana_program::program_option::COption::Some(*authority.key)
        || input.delegated_amount != amount
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    for (info, expected_mint) in [(staging_in, input_mint), (staging_out, output_mint)] {
        let account = token(info)?;
        same(&account.owner, authority.key)?;
        same(&account.mint, expected_mint.key)?;
        if account.delegate.is_some() || account.close_authority.is_some() {
            return Err(ProgramError::InvalidAccountData);
        }
    }
    let names = [source.key, destination.key, staging_in.key, staging_out.key];
    for i in 0..names.len() {
        for j in i + 1..names.len() {
            if names[i] == names[j] {
                return Err(ProgramError::InvalidAccountData);
            }
        }
    }
    let before = token(staging_out)?.amount;
    let provider_accounts = &accounts[11..];
    // Only the four supported receipt-token instructions; no borrowing, leverage,
    // vault signature, extra outside signer, or caller-supplied instruction data.
    let (count, src, dst, mint_index, receipt_index, disc) = match (provider, action) {
        (0, 0) => (12, 7, 8, 4, 6, K_DEPOSIT),
        (0, 1) => (12, 7, 8, 4, 5, K_REDEEM),
        (1, 0) => (17, 1, 2, 3, 6, J_DEPOSIT),
        (1, 1) => (18, 1, 2, 5, 6, J_REDEEM),
        _ => unreachable!(),
    };
    if provider_accounts.len() != count {
        return Err(ProgramError::InvalidInstructionData);
    }
    same(provider_accounts[0].key, authority.key)?;
    same(provider_accounts[src].key, staging_in.key)?;
    same(provider_accounts[dst].key, staging_out.key)?;
    same(provider_accounts[mint_index].key, asset.key)?;
    same(provider_accounts[receipt_index].key, receipt.key)?;
    if provider_accounts.iter().any(|a| {
        a.key == vault.key
            || a.key == source.key
            || a.key == destination.key
            || (a.is_signer && a.key != authority.key)
    }) {
        return Err(ProgramError::InvalidAccountData);
    }
    transfer(
        source,
        staging_in,
        input_mint,
        authority,
        token_program,
        amount,
        input_decimals,
        seeds,
    )?;
    let mut bytes = disc.to_vec();
    bytes.extend_from_slice(&amount.to_le_bytes());
    let metas = provider_accounts
        .iter()
        .map(|a| {
            if a.is_writable {
                AccountMeta::new(*a.key, a.key == authority.key)
            } else {
                AccountMeta::new_readonly(*a.key, a.key == authority.key)
            }
        })
        .collect();
    let ix = Instruction {
        program_id: *venue.key,
        accounts: metas,
        data: bytes,
    };
    let mut infos = provider_accounts.to_vec();
    infos.push(venue.clone());
    invoke_signed(&ix, &infos, &[seeds])?;
    let after = token(staging_out)?.amount;
    if after
        .checked_sub(before)
        .ok_or(ProgramError::InvalidAccountData)?
        < minimum
    {
        return Err(ProgramError::Custom(1));
    }
    // Sweep the actual balance, not an off-chain estimate. This is why the
    // router exists: Kamino redemption output can change with reserve interest.
    transfer(
        staging_out,
        destination,
        output_mint,
        authority,
        token_program,
        after,
        output_decimals,
        seeds,
    )?;
    let unspent = token(staging_in)?.amount;
    if unspent > 0 {
        transfer(
            staging_in,
            source,
            input_mint,
            authority,
            token_program,
            unspent,
            input_decimals,
            seeds,
        )?;
    }
    Ok(())
}
fn transfer<'a>(
    source: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    program: &AccountInfo<'a>,
    amount: u64,
    decimals: u8,
    seeds: &[&[u8]],
) -> ProgramResult {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let ix = Instruction {
        program_id: *program.key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            source.clone(),
            mint.clone(),
            dest.clone(),
            authority.clone(),
            program.clone(),
        ],
        &[seeds],
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_ambiguous_wire_and_unbounded_amounts() {
        for bytes in [vec![], vec![0; 19], vec![1; 20]] {
            assert!(terms(&bytes).is_err());
        }
        let mut bytes = vec![1, 0, 0];
        bytes.extend_from_slice(&u64::MAX.to_le_bytes());
        bytes.extend_from_slice(&1u64.to_le_bytes());
        assert!(terms(&bytes).is_err());
    }
    #[test]
    fn decodes_exact_bounded_terms() {
        let mut bytes = vec![1, 1, 1];
        bytes.extend_from_slice(&10u64.to_le_bytes());
        bytes.extend_from_slice(&9u64.to_le_bytes());
        assert_eq!(terms(&bytes).unwrap(), (1, 1, 10, 9));
    }
}
