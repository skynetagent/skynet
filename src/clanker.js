const { createPublicClient, createWalletClient, http, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base } = require('viem/chains');

class ClankerClient {
  constructor(privateKey, rpcUrl, rewardAddress) {
    this.rewardAddress = rewardAddress;

    const account = privateKeyToAccount(privateKey);
    this.account = account;

    const transport = http(rpcUrl || undefined);

    this.publicClient = createPublicClient({
      chain: base,
      transport,
    });

    this.walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
  }

  /**
   * Deploy an ERC20 token via Clanker v4.
   * @param {object} opts - { name, symbol }
   * @returns {{ txHash: string, contractAddress: string }}
   */
  async deploy({ name, symbol }) {
    // Check gas balance before attempting deployment
    const balance = await this.publicClient.getBalance({ address: this.account.address });
    const minGas = BigInt('500000000000000'); // 0.0005 ETH
    if (balance < minGas) {
      throw new Error(`Insufficient gas: ${formatEther(balance)} ETH (need ~0.0005 ETH). Fund ${this.account.address} on Base.`);
    }

    // Dynamic import — clanker-sdk/v4 is ESM
    const { Clanker } = await import('clanker-sdk/v4');

    const clanker = new Clanker({
      wallet: this.walletClient,
      publicClient: this.publicClient,
    });

    const result = await clanker.deploy({
      name,
      symbol,
      tokenAdmin: this.account.address,
      rewards: {
        recipients: [
          {
            admin: this.account.address,
            recipient: this.rewardAddress,
            bps: 10000,
            token: 'Both',
          },
        ],
      },
    });

    if (result.error) {
      throw new Error(`Clanker deploy failed: ${result.error}`);
    }

    const txHash = result.txHash;

    // Wait for on-chain confirmation
    const confirmation = await result.waitForTransaction();
    if (confirmation.error) {
      throw new Error(`Clanker tx failed: ${confirmation.error}`);
    }

    return {
      txHash,
      contractAddress: confirmation.address,
    };
  }
}

module.exports = { ClankerClient };
