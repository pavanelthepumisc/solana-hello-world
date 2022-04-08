use borsh::{BorshDeserialize, BorshSerialize};
use serde::Deserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint, msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use std::str;

/// The type of state managed by this program. The type defined here
/// much match the `CandidateAccount` type defined by the client.
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CandidateAccount {
    pub age: u32,
    pub experience: u32,
    pub first_name: String,
    pub last_name: String,
    pub qualification: String,
}

#[derive(Deserialize, Debug)]
pub struct CandidateData {
    pub age: u32,
    pub experience: u32,
    pub first_name: String,
    pub last_name: String,
    pub qualification: String,
}

// Declare the programs entrypoint. The entrypoint is the function
// that will get run when the program is executed.
#[cfg(not(feature = "exclude_entrypoint"))]
entrypoint!(process_instruction);

/// Logic that runs when the program is executed. This program expects
/// a single account that is owned by the program as an argument and
/// no instructions.
///
/// The account passed in ought to contain a `CandidateAccount`. This
/// program will increment the `age` value in the
/// `CandidateAccount` when executed.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> entrypoint::ProgramResult {
    let candidate_data = match str::from_utf8(instruction_data) {
        Ok(v) => v,
        Err(e) => panic!("Invalid UTF-8 sequence: {}", e),
    };

    let candidate_data_json: CandidateData = serde_json::from_str(candidate_data).unwrap();

    msg!(
        "1 - Hello World Rust program entrypoint {:?}",
        candidate_data_json.first_name
    );
    // Get the account that stores candidate information.
    let accounts_iter = &mut accounts.iter();
    let account = next_account_info(accounts_iter)?;

    // The account must be owned by the program in order for the
    // program to write to it. If that is not the case then the
    // program has been invoked incorrectly and we report as much.
    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Deserialize the candidate information from the account, modify
    // it, and then write it back.
    // let mut candidate = CandidateAccount::try_from_slice(&account.data.borrow())?;
    let mut candidate = solana_program::borsh::try_from_slice_unchecked::<CandidateAccount>(
        &account.data.borrow(),
    )?;
    candidate.age = candidate_data_json.age;
    candidate.experience = candidate_data_json.experience;
    candidate.first_name = String::from(candidate_data_json.first_name);
    candidate.last_name = String::from(candidate_data_json.last_name);
    candidate.qualification = String::from(candidate_data_json.qualification);
    candidate.serialize(&mut &mut account.data.borrow_mut()[..])?;
    Ok(())
}
