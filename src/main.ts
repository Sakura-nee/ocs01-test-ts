import * as axios from 'axios';
import wallet from "../wallet.json" assert { type: "json" };
import contract from "../exec_interface.json" assert { type: "json" };

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
            throw new Error(`api error: ${err.response.data}`);
        }
        throw err;
    }
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

// test
const greeting = await view_call(
    wallet.rpc,
    contract.contract,
    contract.methods[0]?.name || '',
    [],
    wallet.addr,
);

console.log(greeting);