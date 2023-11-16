import { AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getATokenAccountsNeedCreate, getTokenAccount, sleep } from './util';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58'
import fetch from 'cross-fetch';
import { Wallet } from '@project-serum/anchor';
require('dotenv').config();

export const connection = new Connection(process.env.RPC);
console.log(process.env.PRIVATE_KEY )

const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY || ''))));
console.log("wallet publickey ", wallet.publicKey.toBase58())
console.log("wallet ", wallet)

export const retrieveRouteMap = async () => {
    
    // Retrieve the `indexed-route-map`
    const indexedRouteMap = await (await fetch('https://quote-api.jup.ag/v6/indexed-route-map')).json();
    // console.log("indexedRouteMap ", indexedRouteMap)

    const getMint = (index: any) => indexedRouteMap["mintKeys"][index];
    const getIndex = (mint: any) => indexedRouteMap["mintKeys"].indexOf(mint);

    // Generate the route map by replacing indexes with mint addresses
    var generatedRouteMap = {};
    Object.keys(indexedRouteMap['indexedRouteMap']).forEach((key, index) => {
    generatedRouteMap[getMint(key)] = indexedRouteMap["indexedRouteMap"][key].map((index) => getMint(index))
    });

    // List all possible input tokens by mint address
    const allInputMints = Object.keys(generatedRouteMap);
    // console.log("allInputMints ", allInputMints)

    // List all possition output tokens that can be swapped from the mint address for SOL.
    // SOL -> X
    const swappableOutputForSOL = generatedRouteMap['So11111111111111111111111111111111111111112'];
    // console.log("swappableOutputForSOL ", swappableOutputForSOL)
    // console.log({ allInputMints, swappableOutputForSOL })
}

export const getRoute4Swap = async (inputMint: string, outputMint: string, amount: number|string, bps: number) => {
    // Swapping SOL to USDC with input 0.1 SOL and 0.5% slippage
    const quoteResponse = await (
        await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${bps}&maxAccounts=64`
        )
    ).json();
    console.log("quoteResponse ", quoteResponse)
    // console.log("route plan ", quoteResponse.routePlan)
    return quoteResponse
    // console.log({ quoteResponse })

}

export const getSerializedTx = async (quoteResponse: any) => {
    // get serialized transactions for the swap
    const result = await (
        await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            // quoteResponse from /quote api
            quoteResponse,
            // user public key to be used for the swap
            userPublicKey: wallet.publicKey.toString(),
            // auto wrap and unwrap SOL. default is true
            wrapAndUnwrapSol: true,
            // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
            // feeAccount: "fee_account_public_key"
        })
        })
    ).json();
    // { swapTransaction }
    console.log("getting swap tx ", result)
    return result.swapTransaction
}

export const deserializeAndSignTx = async (swapTransaction: any) => {
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // transaction.message
    console.log(transaction);

    // sign the transaction
    transaction.sign([wallet.payer]);
    return transaction
}

export const execTx = async (transaction: VersionedTransaction) => {
    // Execute the transaction
    
    // const txid = await connection.sendTransaction(transaction);
    const rawTransaction = transaction.serialize()
    // await sendAndConfirmTransaction(connection, transaction, [wallet.payer])

    console.log(rawTransaction)
    const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 2,

    });
    console.log(`https://solscan.io/tx/${txid}`);
    // await connection.confirmTransaction(txid, "confirmed");
    const blockhash = await connection.getLatestBlockhash();
    const confirmed = await connection.confirmTransaction(
        {
            signature: txid,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
        }, "processed");
        console.log("confirmed ", confirmed)
}

const getAdressLookupTableAccounts = async (
    keys: string[]
): Promise<AddressLookupTableAccount[]> => {
    console.log(" LUT address ", keys)
    const addressLookupTableAccountInfos = await connection.getMultipleAccountsInfo(keys.map((key) => new PublicKey(key)));

    return addressLookupTableAccountInfos.reduce((acc, accountInfo, index) => {
        const addressLookupTableAddress = keys[index];
        if (accountInfo) {
        const addressLookupTableAccount = new AddressLookupTableAccount({
            key: new PublicKey(addressLookupTableAddress),
            state: AddressLookupTableAccount.deserialize(accountInfo.data),
        });
        acc.push(addressLookupTableAccount);
        }

        return acc;
    }, new Array<AddressLookupTableAccount>());
};

export const getSwapInx = async (quoteResponse: any) => {
    let inxAccounts: string[] = [];

    const instructions = await (
        await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            // quoteResponse from /quote api
            quoteResponse,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            computeUnitPriceMicroLamports: 'auto'
          })
        })
    ).json();
    // console.log(" swap instruction ", instructions)
    const {
        tokenLedgerInstruction: tokenLedgerInstructionPayload, // If you are using `useTokenLedger = true`.
        computeBudgetInstructions: computeBudgetInstructionsPayload, // The necessary instructions to setup the compute budget.
        setupInstructions: setupInstructionsPayload, // Setup missing ATA for the users.
        swapInstruction: swapInstructionPayload, // The actual swap instruction.
        cleanupInstruction: cleanupInstructionPayload, // Unwrap the SOL if `wrapAndUnwrapSol = true`.
        addressLookupTableAddresses, // The lookup table addresses that you can use if you are using versioned transaction.
    } = instructions;
    // console.log(" swapInstructionPayload ", instructions)
    // console.log("cleanupInstruction ", instructions.cleanupInstruction)
    // console.log("type of cleanupInstruction ",  typeof instructions.cleanupInstruction)
    // console.log("addressLookupTableAddresses ", addressLookupTableAddresses)
    
    // console.log("swapInstructionPayload ", swapInstructionPayload)
    const swapInstruction = new TransactionInstruction({
    programId: new PublicKey(swapInstructionPayload.programId),
    keys: swapInstructionPayload.accounts.map((key) => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
    })),
    data: Buffer.from(swapInstructionPayload.data, "base64"),
    });

    swapInstructionPayload.accounts.map((key) => {
        if (!inxAccounts.includes(key.pubkey)) {
            console.log("swap addresses ", key.pubkey)
            inxAccounts.push(key.pubkey)
        }
    })


    // const tokenLedgerInstruction = tokenLedgerInstructionPayload? new TransactionInstruction({
    //     programId: new PublicKey(tokenLedgerInstructionPayload.programId),
    //     keys: tokenLedgerInstructionPayload.accounts.map((key) => ({
    //         pubkey: new PublicKey(key.pubkey),
    //         isSigner: key.isSigner,
    //         isWritable: key.isWritable,
    //         })),
    //     data: Buffer.from(tokenLedgerInstructionPayload.data, "base64"),
    // }): null;

    // const computeBudgetInstructions = new TransactionInstruction({
    //     programId: new PublicKey(computeBudgetInstructionsPayload.programId),
    //     keys: computeBudgetInstructionsPayload.accounts.map((key) => ({
    //         pubkey: new PublicKey(key.pubkey),
    //         isSigner: key.isSigner,
    //         isWritable: key.isWritable,
    //         })),
    //     data: Buffer.from(computeBudgetInstructionsPayload.data, "base64"),
    // });

    let setupInstructions: TransactionInstruction[] = [];

    // console.log("setupInstructionPayload ", setupInstructionsPayload)
    setupInstructionsPayload.map(setupInstructionPayload => {
        setupInstructions.push(new TransactionInstruction({
            programId: new PublicKey(setupInstructionPayload.programId),
            keys: setupInstructionPayload.accounts.map((key) => ({
                pubkey: new PublicKey(key.pubkey),
                isSigner: key.isSigner,
                isWritable: key.isWritable,
                })),
            data: Buffer.from(setupInstructionPayload.data, "base64"),
        }));

        setupInstructionPayload.accounts.map((key) =>{
            if (!inxAccounts.includes(key.pubkey)) {
                console.log("setup addresses ", key.pubkey)
                inxAccounts.push(key.pubkey)
            }
        })
    })
    // const setupInstructions = ;


    const cleanupInstructions = cleanupInstructionPayload?[new TransactionInstruction({
        programId: new PublicKey(cleanupInstructionPayload.programId),
        keys: cleanupInstructionPayload.accounts.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
            })),
        data: Buffer.from(cleanupInstructionPayload.data, "base64"),
    })]: [];
    if (cleanupInstructionPayload) {
        cleanupInstructionPayload.accounts.map((key) => {
            if (!inxAccounts.includes(key.pubkey)) {
                console.log(" address for cleanup Inx ", key.pubkey)
                inxAccounts.push(key.pubkey)
            }
        })
    }
    
    return {
        swapInstruction,
        setupInstructions,
        cleanupInstructions,
        inxAccounts,
    }
    //   let {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash()
      
    //   const messageV0 = new TransactionMessage({
    //     payerKey: wallet.publicKey,
    //     recentBlockhash: blockhash,
    //     instructions: [swapInstruction],
    //   }).compileToV0Message(addressLookupTableAccounts);
    //   const transaction = new VersionedTransaction(messageV0);
}

export const swap = async (swapRoutes: PublicKey[], initAmount: number | string) => {
    if (swapRoutes.length<2) {
        console.log("can not swap only 1 token!")
        return;
    }

    // let finalTx = new Transaction()
        
    // let route = await getRoute4Swap(swapRoutes[0].toBase58(), swapRoutes[1].toBase58(), initAmount, 50)
    // let serializedTx = await getSerializedTx(route)
    // // const tx = Transaction.from(serializedTx)
    // let transactionx = await deserializeAndSignTx(serializedTx)
    // await execTx(transactionx)
    // return;
    
    


    
    let nextInputAmount = initAmount;
    let swapInxs:TransactionInstruction[] = [];

    // let computeBudgetInxs:TransactionInstruction[] = [];
    let setupInxs:TransactionInstruction[] = [];
    let cleanupInxs:TransactionInstruction[] = [];
    let txAccountAddresses: string[] = [];
    let txAccounts: PublicKey[] = []

    let addressLookupTableAccounts: AddressLookupTableAccount[] = [];
    let addressLookupTableAddresses: string[] = [];

    for (let i=0; i< swapRoutes.length-1; i++) {
        let quoteResponse = await getRoute4Swap(swapRoutes[i].toBase58(), swapRoutes[i+1].toBase58(), nextInputAmount, 200)
        nextInputAmount = quoteResponse.outAmount
        const {
            swapInstruction, 
            setupInstructions,
            cleanupInstructions,
            // addressLookupTableAddresses: addressLookupTableAddressesPayload, 
            inxAccounts: inxAccountAddressesPayload
        } = await getSwapInx(quoteResponse)

        // addressLookupTableAddressesPayload.map(addressLookupTableAddressePayload => {
        //     if (!addressLookupTableAddresses.includes(addressLookupTableAddressePayload)) addressLookupTableAddresses.push(addressLookupTableAddressePayload)
        // })

    
        // addressLookupTableAccounts.push(
        // ...(await getAdressLookupTableAccounts(addressLookupTableAddresses))
        // );

        // console.log("swapInstruction, ", swapInstruction)
        // console.log("addressLookupTableAccounts, ", addressLookupTableAccounts)
        swapInxs.push(swapInstruction)
        // if (setupInstructions && setupInstructions.length>0) 
        setupInxs.push(...setupInstructions)
        // if (cleanupInstruction && cleanupInstruction!= null) 
        console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
        console.log("returned cleanupInstruction ", cleanupInstructions)
        console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
        cleanupInxs.push(...cleanupInstructions)
        inxAccountAddressesPayload.map(inxAccountAddressPayload => {

            if (!txAccountAddresses.includes(inxAccountAddressPayload)) txAccountAddresses.push(inxAccountAddressPayload)
        })
        // addressLookupTableAccounts.push(...addressLookupTableAccounts)
    }
    console.log("final output amount ", nextInputAmount);


    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 2000000
    })
    modifyComputeUnits.keys.map((key) => {
        if (!txAccountAddresses.includes(key.pubkey.toBase58())) {
            console.log(" modifyComputeUnits ", key.pubkey.toBase58())
            txAccountAddresses.push(key.pubkey.toBase58())
        }
    })

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1
    })
    addPriorityFee.keys.map((key) => {
        if (!txAccountAddresses.includes(key.pubkey.toBase58())) {
            console.log(" addPriorityFee ",  key.pubkey.toBase58())
            txAccountAddresses.push(key.pubkey.toBase58())
        }
    })

   

    // console.log("txAccountAddresses ", txAccountAddresses)

    txAccountAddresses.map(address => {
        txAccounts.push(new PublicKey(address))
    })

      
    // console.log("Setup --- Raw Instructions ", setupInxs);
    // console.log("Swap --- Raw Instructions ", swapInxs);

    // const messageV0 = new TransactionMessage({
    //     payerKey: wallet.publicKey,
    //     recentBlockhash: blockhash,
    //     instructions: [modifyComputeUnits, addPriorityFee, ...setupInxs, ...swapInxs],
    //     // ...cleanupInxs
    // }).compileToV0Message(addressLookupTableAccounts);
    // const transaction = new VersionedTransaction(messageV0);
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>> transaction version \n", transaction.message.version)
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> header \n ", transaction.message.header)
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> staticAccountKeys \n ", transaction.message.staticAccountKeys)
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> compiledInstructions \n ", transaction.message.compiledInstructions)
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> addressTableLookups \n ", transaction.message.addressTableLookups)
    // console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> staticAccountKeys Length: \n ", transaction.message.staticAccountKeys.length)
    // transaction.sign([wallet.payer])
    // console.log("Transaction signed: ", transaction);
    // await execTx(transaction)


    let slot = await connection.getSlot();

    const currentSlot = await connection.getSlot("confirmed");
//   console.log('currentSlot:', currentSlot);
//   const slots = await connection.getBlocks(currentSlot - 200);
//   if (slots.length < 100) {
//     console.log("error for slot...")
//     throw new Error(`Could find only ${slots.length} ${slots} on the main fork`);
//   }

    // console.log(" slot ", slot, slots[0], slots[slots.length-1])
    const [inst, tableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: wallet.publicKey,
        payer: wallet.publicKey,
        recentSlot: currentSlot - 50,


    });

    // let addressList = [];
    // for (let key of transaction.message.staticAccountKeys) {
    //     addressList.push(key);
    // }
    let lookupTx = new Transaction().add(inst);
    let txHash = await sendAndConfirmTransaction(connection, lookupTx, [wallet.payer]);
    console.log("txHash =", txHash);
    for ( let i= 0; i< Math.ceil(txAccounts.length/20);i++) {
        let tmpTx = new Transaction()
        const extInst = AddressLookupTableProgram.extendLookupTable({
            authority: wallet.publicKey,
            payer: wallet.publicKey,
            lookupTable: tableAddress,
            addresses: txAccounts.slice(i*20, Math.min((i+1)*20, txAccounts.length))
        });
        console.log(i*20, Math.min((i+1)*20, txAccounts.length))
        tmpTx.add(extInst)

        txHash = await sendAndConfirmTransaction(connection, tmpTx, [wallet.payer]);
        console.log("txHash =", txHash);
    }
    // await connection.confirmTransaction(txHash, "finalized")

    await sleep(5000)
    
    console.log("txAccounts ", txAccounts.length)

    let lookupTableAccount = (await connection.getAddressLookupTable(tableAddress)).value;
    console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
        const address = lookupTableAccount.state.addresses[i];
        console.log(i, address.toBase58());
    }

    addressLookupTableAccounts.push(
        ...(await getAdressLookupTableAccounts([tableAddress.toBase58()]))
    );

    console.log(" addressLookupTableAccounts ", addressLookupTableAccounts)
    
    const {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash()

    const messageV0_new = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [modifyComputeUnits, addPriorityFee, ...setupInxs, ...swapInxs, ...cleanupInxs],
        // 
    }).compileToV0Message(addressLookupTableAccounts);
    
    const transaction_new = new VersionedTransaction(messageV0_new);
    console.log(">>>>>>>>>>>>>>>>>>>>>>>>>> staticAccountKeys Length: \n ", transaction_new.message.staticAccountKeys.length)
    transaction_new.sign([wallet.payer])
    console.log("transaction_new signed: ", );
    await execTx(transaction_new)

    // const deserializedTx = VersionedTransaction.deserialize()
    // wallet.signTransaction()
//     const versionedTxBuffer = transaction.serialize()
//     console.log(">>0")
//     const tx = Transaction.from(versionedTxBuffer)
// console.log(">>1")
//     tx.recentBlockhash = blockhash;
//     tx.feePayer = wallet.publicKey;
//     wallet.signTransaction(tx);
//     console.log(">>2")
//     let txId = await connection.sendTransaction(tx, [wallet.payer]);
//     console.log(">>3")
//     await connection.confirmTransaction(txId, "confirmed");



}

export const fetchLUTaddresses = async () => {
    
    let lookupTableAccount = (await connection.getAddressLookupTable(new PublicKey("FF6uikKXNn8jhtpF8o6ChYBbeNXx91kCBwsusbULp4tj"))).value;
    console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
        const address = lookupTableAccount.state.addresses[i];
        console.log(i, address.toBase58());
      }
    
    
    
    // let lookupTableAccount = (await connection.getAddressLookupTable(new PublicKey("AF1C4K4QSqPMDk8oLYDGGyanxAyFnnmjRxihpFSQ9cYv"))).value;
    // console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    // for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
    //     const address = lookupTableAccount.state.addresses[i];
    //     console.log(i, address.toBase58());
    //   }

    //   lookupTableAccount = (await connection.getAddressLookupTable(new PublicKey("3Q47nV9sZtRkJwUBB6UvU8JFJj9geSnVz88TMj2X5fdb"))).value;
    // console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    // for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
    //     const address = lookupTableAccount.state.addresses[i];
    //     console.log(i, address.toBase58());
    //   }

    //   lookupTableAccount = (await connection.getAddressLookupTable(new PublicKey("UvaxXGNUe5Rk6L3xBG7uzkEug7z7tiUfAbqDgK6wvkb"))).value;
    // console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    // for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
    //     const address = lookupTableAccount.state.addresses[i];
    //     console.log(i, address.toBase58());
    //   }

    //   lookupTableAccount = (await connection.getAddressLookupTable(new PublicKey("J73motbRk4WuL41XQ3dJrdd8aFyM2GffwnpNPaegvPyq"))).value;
    // console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    // for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
    //     const address = lookupTableAccount.state.addresses[i];
    //     console.log(i, address.toBase58());
    //   }


}