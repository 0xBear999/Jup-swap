
import fs from 'fs';
import path from 'path';
import {
    PublicKey,
    Connection,
    Keypair
} from '@solana/web3.js';
import { retrieveRouteMap, getRoute4Swap, getSerializedTx, swap, fetchLUTaddresses } from './script';
import { SOL_ADDRESS, USDC_ADDRESS, STSOL_ADDRESS } from './types';


// let solConnection = null;
// let payer = null;


// export const setClusterConfig = async (cluster: web3.Cluster) => {
//     solConnection = new web3.Connection(web3.clusterApiUrl(cluster));
//     const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(process.env.ANCHOR_WALLET), 'utf-8'))), { skipValidation: true });
//     const wallet = new NodeWallet(walletKeypair);
//     anchor.setProvider(new anchor.AnchorProvider(solConnection, wallet, { skipPreflight: true, commitment: 'confirmed' }));
//     payer = wallet;
// }


const main = async () => {
    try {
        await retrieveRouteMap()
        // STSOL_ADDRESS,,  SOL_ADDRESS
        await swap([SOL_ADDRESS, USDC_ADDRESS, STSOL_ADDRESS, SOL_ADDRESS], 10000000)//
        // await fetchLUTaddresses()
    } catch (e) {
        console.log("err ", e)
    }
}

main()