/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  ConfirmedSignaturesForAddress2Options,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import { getPayer, getRpcUrl, createKeypairFromFile } from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Hello world's program id
 */
let programId: PublicKey;

/**
 * The public key of the account we are saying hello to
 */
let candidatePubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'helloworld.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/helloworld.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'helloworld-keypair.json');

/**
 * The state of a candidate account managed by the hello world program
 */
class CandidateAccount {
  age = 0;
  experience = 0;
  first_name = '';
  constructor(fields: { age: number, experience: number, first_name: string } | undefined = undefined) {
    if (fields) {
      this.age = fields.age;
      this.experience = fields.experience;
      this.first_name = fields.first_name;
    }
  }
}

/**
 * Borsh schema definition for candidate accounts
 */
const CandidateSchema = new Map([
  [CandidateAccount, { kind: 'struct', fields: [['age', 'u32'], ['experience', 'u32'], ['first_name', 'String']] }],
]);

/**
 * The expected size of each candidate account.
 */
const CANDIDATE_SIZE = borsh.serialize(
  CandidateSchema,
  new CandidateAccount(),
).length * 4;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const { feeCalculator } = await connection.getRecentBlockhash();

    // Calculate the cost to fund the candidate account
    fees += await connection.getMinimumBalanceForRentExemption(CANDIDATE_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

/**
 * Check if the hello world BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/helloworld.so\``,
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);

  const slot = await connection.getSlot();

  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/helloworld.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address (public key) of a candidate account from the program so that it's easy to find later.
  const CANDIDATE_SEED = 'hello' + getRandomInt(3);

  console.log("Candidate ID:: " + CANDIDATE_SEED);
  candidatePubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    CANDIDATE_SEED,
    programId,
  );

  // Check if the candidate account has already been created
  const candidateAccount = await connection.getAccountInfo(candidatePubkey);
  if (candidateAccount === null) {
    console.log(
      'Creating account',
      candidatePubkey.toBase58(),
      'to say hello to',
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      CANDIDATE_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: CANDIDATE_SEED,
        newAccountPubkey: candidatePubkey,
        lamports,
        space: CANDIDATE_SIZE,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

/**
 * Say hello
 */
export async function sayHello(): Promise<void> {
  console.log('Saying hello to', candidatePubkey.toBase58());

  let candidateData = {
    age: 12,
    experience: 1,
    first_name: "Elthepu"
  }

  const instruction = new TransactionInstruction({
    keys: [{ pubkey: candidatePubkey, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.from(JSON.stringify(candidateData))
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
}

/**
 * Report the number of times the candidate account has been said hello to
 */
export async function getCandidates(): Promise<void> {
  // Get all transactions of an account
  const transSignatures = await getTransactionsOfUser(programId);

  // Get all accounts
  const accounts = await connection.getProgramAccounts(programId);
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log(account.pubkey + "^^^^^^^^^^", getAcountData(account.account.data));
  }

  // console.log("Transactions for " + candidatePubkey);
  // console.log({ transSignatures });

  const accountInfo = await connection.getAccountInfo(candidatePubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the candidate account';
  }
  const candidateData = getAcountData(accountInfo.data);
  console.log(
    candidatePubkey.toBase58(),
    'has age ',
    candidateData.age,
    " and experience ",
    candidateData.experience,
    ' and first_name ',
    candidateData.first_name,
  );
}

function getAcountData(data: Buffer) {
  return borsh.deserializeUnchecked(
    CandidateSchema,
    CandidateAccount,
    data,
  )
}

export async function getTransactionsOfUser(address: PublicKey, options?: ConfirmedSignaturesForAddress2Options) {
  try {

    const publicKey = new PublicKey(address);
    const transSignatures =
      await connection.getConfirmedSignaturesForAddress2(publicKey, options);
    const transactions = [];
    for (let i = 0; i < transSignatures.length; i++) {
      const signature = transSignatures[i].signature;
      const confirmedTransaction = await connection.getTransaction(
        signature,
      );
      if (confirmedTransaction) {
        const { meta } = confirmedTransaction;
        if (meta) {
          const oldBalance = meta.preBalances;
          const newBalance = meta.postBalances;
          const amount = oldBalance[0] - newBalance[0];
          const transWithSignature = {
            signature,
            ...confirmedTransaction,
            fees: meta?.fee,
            amount,
          };
          transactions.push(transWithSignature);
        }
      } else {
        console.log("+++++++++++" + signature);
      }
    }
    return transactions;
  } catch (err) {
    throw err;
  }
}