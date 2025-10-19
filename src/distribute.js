const { Connection, Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Configuration - Load from environment variables
const RPC_URL = process.env.RPC_URL || "YOUR_RPC_URL_HERE";
const SENDER_API_URL = process.env.SENDER_API_URL || RPC_URL;

// Load keypair from parent directory
const keypairPath = path.join(__dirname, '..', '..', 'keypair.json');
const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

console.log("Sender Wallet:", senderKeypair.publicKey.toString());

// Load wallet list from snapshot
function loadWalletList() {
  const parentDir = path.join(__dirname, '..', '..');
  const files = fs.readdirSync(parentDir);
  const snapshotFiles = files.filter(f => f.startsWith('pumpfun_wallets_') && f.endsWith('_snapshot.json'));
  
  if (snapshotFiles.length === 0) {
    throw new Error("No snapshot file found! Run the snapshot tool first.");
  }
  
  const mostRecent = snapshotFiles
    .map(f => ({ name: f, time: fs.statSync(path.join(parentDir, f)).mtime }))
    .sort((a, b) => b.time - a.time)[0].name;
  
  console.log(`Loading wallets from: ${mostRecent}`);
  
  const snapshot = JSON.parse(fs.readFileSync(path.join(parentDir, mostRecent), 'utf8'));
  return snapshot.wallets.filter(w => w !== senderKeypair.publicKey.toString());
}

async function getBalance(connection, pubkey) {
  const balance = await connection.getBalance(pubkey);
  return balance / LAMPORTS_PER_SOL;
}

async function sendTransactionWithSender(connection, transaction, signer) {
  const { blockhash } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = signer.publicKey;
  transaction.sign(signer);
  
  const serializedTransaction = transaction.serialize().toString('base64');
  
  const response = await fetch(SENDER_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        serializedTransaction,
        {
          encoding: 'base64',
          skipPreflight: true,
          preflightCommitment: 'finalized',
          maxRetries: 2,
          sendOptions: {
            useBundle: false,
            priorityLevel: 'veryHigh'
          }
        }
      ]
    })
  });
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`${result.error.message}`);
  }
  
  return result.result;
}

async function distributeSOL() {
  console.log("\n" + "=".repeat(80));
  console.log("Token Spawner - Powered by Helius Sender");
  console.log("=".repeat(80));
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  const wallets = loadWalletList();
  console.log(`\nLoaded ${wallets.length} recipient wallets`);
  
  const balance = await getBalance(connection, senderKeypair.publicKey);
  console.log(`Sender Balance: ${balance.toFixed(6)} SOL`);
  
  if (balance <= 0.001) {
    console.error("Error: Balance too low (need at least 0.001 SOL)!");
    return;
  }
  
  const RECIPIENTS_PER_TX = 15;
  const numTransactions = Math.ceil(wallets.length / RECIPIENTS_PER_TX);
  const estimatedFees = 0.000005 * numTransactions;
  const totalToDistribute = balance - estimatedFees - 0.0001;
  const amountPerWallet = totalToDistribute / wallets.length;
  
  console.log(`\nDistribution Plan:`);
  console.log(`- Recipients: ${wallets.length}`);
  console.log(`- Transactions: ${numTransactions} (15 recipients each)`);
  console.log(`- Total to distribute: ${totalToDistribute.toFixed(6)} SOL`);
  console.log(`- Amount per wallet: ${amountPerWallet.toFixed(9)} SOL`);
  console.log(`- Estimated fees: ${estimatedFees.toFixed(6)} SOL`);
  
  console.log("\n" + "=".repeat(80));
  console.log("WARNING: This will send SOL to all wallets!");
  console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
  console.log("=".repeat(80));
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log("\nStarting distribution...\n");
  
  let successCount = 0;
  let failCount = 0;
  const signatures = [];
  
  const batches = [];
  for (let i = 0; i < wallets.length; i += RECIPIENTS_PER_TX) {
    const batch = wallets.slice(i, Math.min(i + RECIPIENTS_PER_TX, wallets.length));
    batches.push({ 
      batchIndex: Math.floor(i / RECIPIENTS_PER_TX) + 1,
      wallets: batch,
      startIdx: i
    });
  }
  
  console.log(`Created ${batches.length} transactions`);
  console.log(`Processing in chunks of 1000 with retry logic...\n`);
  
  async function processBatch(batch, retryCount = 0) {
    try {
      const transaction = new Transaction();
      
      batch.wallets.forEach(wallet => {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: senderKeypair.publicKey,
            toPubkey: new PublicKey(wallet),
            lamports: Math.floor(amountPerWallet * LAMPORTS_PER_SOL)
          })
        );
      });
      
      const signature = await sendTransactionWithSender(connection, transaction, senderKeypair);
      
      console.log(`✓ [TX ${batch.batchIndex}/${batches.length}] Sent to ${batch.wallets.length} wallets | Sig: ${signature.substring(0, 12)}...`);
      
      successCount += batch.wallets.length;
      batch.wallets.forEach(wallet => {
        signatures.push({ wallet, signature });
      });
      
      return { success: true, batch, signature };
    } catch (error) {
      if (retryCount < 2) {
        console.log(`⟳ [TX ${batch.batchIndex}/${batches.length}] Retry ${retryCount + 1}/2...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return processBatch(batch, retryCount + 1);
      }
      
      console.error(`✗ [TX ${batch.batchIndex}/${batches.length}] Failed after retries`);
      failCount += batch.wallets.length;
      return { success: false, batch, error: error.message };
    }
  }
  
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < batches.length; i += CHUNK_SIZE) {
    const chunk = batches.slice(i, Math.min(i + CHUNK_SIZE, batches.length));
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(batches.length / CHUNK_SIZE);
    
    console.log(`\n--- Chunk ${chunkNum}/${totalChunks} (${chunk.length} transactions) ---\n`);
    
    const chunkPromises = chunk.map(batch => processBatch(batch));
    await Promise.all(chunkPromises);
    
    console.log(`\n--- Chunk ${chunkNum} Complete: ${successCount} sent, ${failCount} failed ---\n`);
    
    if (i + CHUNK_SIZE < batches.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("DISTRIBUTION COMPLETE");
  console.log("=".repeat(80));
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total: ${wallets.length}`);
  
  const logData = {
    timestamp: new Date().toISOString(),
    sender: senderKeypair.publicKey.toString(),
    totalWallets: wallets.length,
    successCount,
    failCount,
    amountPerWallet,
    totalDistributed: amountPerWallet * successCount,
    transactions: signatures
  };
  
  const logFilename = path.join(__dirname, '..', '..', `distribution_log_${Date.now()}.json`);
  fs.writeFileSync(logFilename, JSON.stringify(logData, null, 2));
  console.log(`\nLog saved to: ${path.basename(logFilename)}`);
  
  const finalBalance = await getBalance(connection, senderKeypair.publicKey);
  console.log(`Final Balance: ${finalBalance.toFixed(6)} SOL`);
  console.log("=".repeat(80));
}

distributeSOL().catch(error => {
  console.error("\nFatal Error:", error);
  process.exit(1);
});
