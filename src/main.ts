import * as axios from 'axios';
import * as ed from '@noble/ed25519';
import ora, { type Ora } from "ora";
import { sha512 } from '@noble/hashes/sha2';
import wallet from "../wallet.json" assert { type: "json" };
import contract from "../exec_interface.json" assert { type: "json" };
import * as readline from "readline";
ed.hashes.sha512 = sha512;

// prompt
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Interface for the configuration object
interface Wallet {
    priv: string;
    addr: string;
    rpc: string;
}

interface Method {
    name: string;
    param_type: string;
    example?: string;
    max?: number;
}

interface Param {
    name: string;
    param_type: string;
    example?: string;
    max?: number;
}

interface Interface {
    contract: string;
    methods: Method[];
}

interface BalanceResponse {
    balance: string;
    nonce: number;
}

interface Tx {
    from: string;
    to_: string;
    amount: string;
    nonce: number;
    ou: string;
    timestamp: number;
}

type HttpMethod = 'GET' | 'POST';

async function api_call(method: HttpMethod, url: string, data?: unknown): Promise<any> {
    try {
        const response = await axios.default({
            method,
            url,
            data,
        })

        return response.data;
    } catch (err: any) {
        if (err.response) {
            throw new Error(`api error: `, err.response.data);
        }
        throw err;
    }
}

async function sign_tx(sk: Uint8Array, tx: Tx): Promise<string> {
    const blob = JSON.stringify({
        from: tx.from,
        to_: tx.to_,
        amount: tx.amount,
        nonce: tx.nonce,
        ou: tx.ou,
        timestamp: tx.timestamp,
    });

    const b64 = Buffer.from(ed.sign(Buffer.from(blob), sk)).toString('base64');
    return b64;
}

async function get_balance(api_url: string, addr: string): Promise<BalanceResponse> {
    const response = await api_call('GET', `${api_url}/balance/${addr}`);
    return { balance: response.balance, nonce: response.nonce };
}

async function view_call(api_url: string, contract: string, method: string, params: string[], caller: string): Promise<string | null> {
    const response = await api_call('POST', `${api_url}/contract/call-view`, {
        contract,
        method,
        params,
        caller,
    });

    if (response.status === 'success') {
        return typeof response.result === 'string' ? response.result : null;
    } else {
        return null;
    }
}

async function call_contract(api_url: string, sk: Uint8Array, address: string, nonce: number, contract: string, method: string, params: string[]): Promise<string> {
    const timestamp = (Date.now() / 1000);
    const TxData = {} as Tx;

    TxData.from = address;
    TxData.to_ = contract;
    TxData.amount = "0";
    TxData.nonce = (nonce + 1);
    console.log(`Using nonce: ${TxData.nonce}`);

    TxData.ou = "1";
    TxData.timestamp = timestamp;

    // sign the transaction
    const signature = await sign_tx(sk, TxData);
    const public_key = Buffer.from(ed.getPublicKey(sk)).toString('base64');

    const response = await api_call('POST', `${api_url}/call-contract`, {
        contract,
        method,
        params,
        caller: address,
        nonce: TxData.nonce,
        timestamp: TxData.timestamp,
        signature,
        public_key,
    })

    return response.tx_hash;
}

async function wait_for_tx(api_url: string, tx_hash: string, max_wait_time: number = 90): Promise<string> {
    const spinner = createLoading("Waiting for transaction confirmation...");
    let elapsed = 0;
    while (true) {
        elapsed += 1;
        const response = await api_call('GET', `${api_url}/tx/${tx_hash}`);
        if (response.status === 'confirmed') {
            stopLoading(spinner, true, "Transaction confirmed!");
            break;
        }

        if (max_wait_time && elapsed >= max_wait_time) {
            stopLoading(spinner, false, "Transaction not confirmed within the maximum wait time.");
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));

    }

    return tx_hash;
}

// utils
function base64ToUnit8Array(b64: string): Uint8Array {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function createLoading(message: string): Ora {
    const spinner = ora(message).start();
    return spinner;
}

function stopLoading(spinner: Ora, success: boolean, message?: string) {
    if (success) {
        spinner.succeed(message);
    } else {
        spinner.fail(message);
    }
    spinner.stop();
}

// Testing
async function main() {
    const sk = base64ToUnit8Array(wallet.priv);
    const address = wallet.addr;
    const api_url = wallet.rpc;
    const contract_address = contract.contract;

    console.log(`Address: ${address}`);
    const { balance, nonce } = await get_balance(api_url, address);
    console.log(`Balance: ${balance}`);
    console.log('\nSelect method:\n')

    let id = 0;
    for (let method of contract.methods) {
        id++;
        console.log(`\t${id}. ${method.name} - ${method.label}`);
    }

    console.log(`\n\t0. Exit`);
    
    const selectedMethod = await prompt('\nChoice: ');
    if (selectedMethod === '0') {
        console.log('Exiting...');
        process.exit(0);
    }

    const methodIndex = parseInt(selectedMethod) - 1;
    const selectedMethodObj = contract.methods[methodIndex];

    switch (selectedMethodObj?.type) {
        case 'view': {
            const params: Record<string, string> = {};
            for (let param of selectedMethodObj.params) {
                let promptText = "";
                promptText += param.name;
                if ('example' in param && param.example) {
                    promptText += ` (e.g. ${param.example})`;
                }
                if ('max' in param && param.max) {
                    promptText += ` [max ${param.max}]`;
                }
                promptText += ": ";
                const answer = await prompt(promptText); 
                params[param.name] = answer;
            }

            const callContract = await view_call(api_url, contract_address, selectedMethodObj.name, Object.values(params), address);
            console.log(`Result: ${callContract}`);
            break;
        }

        case 'call': {
            const params: Record<string, string> = {};
            for (let param of selectedMethodObj.params) {
                let promptText = "";
                promptText += param.name;
                if ('example' in param && param.example) {
                    promptText += ` (e.g. ${param.example})`;
                }
                if ('max' in param && param.max) {
                    promptText += ` [max ${param.max}]`;
                }
                promptText += ": ";
                const answer = await prompt(promptText); 
                params[param.name] = answer;
            }
            const txHash = await call_contract(api_url, sk, address, nonce, contract_address, selectedMethodObj.name, Object.values(params));

            console.log(`Transaction submitted.`);
            const waitTx = await prompt('Wait for transaction confirmation? (y/n): ');
            if (waitTx.toLowerCase() === 'y') {
                await wait_for_tx(api_url, txHash, 5);
            }
            console.log(`Transaction hash: ${txHash}`);
            break;
        }

        default:
            console.log('Invalid selection. Please try again.');
            break;
    }

    await prompt('\nPress Enter to continue...');
    process.stdout.write('\x1Bc');
    main();
}

main()