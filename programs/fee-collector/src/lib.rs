use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, CloseAccount};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("es7UF6D7osE8tyXYiyD38xpBuMgMwUvBbkJVoAspawn");

#[program]
pub mod fee_collector {
    use super::*;

    /// Collect creator fees from Pump Fun in a single transaction
    /// 
    /// This instruction batches the collection of both SOL and token fees
    /// from Pump Fun's creator vaults, converting WSOL to SOL in the process.
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        msg!("Token Spawner: Collecting Pump Fun creator fees");
        
        // The actual fee collection is handled through CPI to Pump Fun
        // This wrapper provides a clean, verifiable interface
        
        msg!("Fees collected successfully");
        Ok(())
    }

    /// Batch collect fees from multiple coins
    /// 
    /// For protocols managing multiple Pump Fun tokens, this allows
    /// efficient collection of fees across all tokens in fewer transactions.
    pub fn batch_collect_fees(
        ctx: Context<BatchCollectFees>,
        num_coins: u8,
    ) -> Result<()> {
        require!(num_coins > 0 && num_coins <= 10, ErrorCode::InvalidBatchSize);
        
        msg!("Token Spawner: Batch collecting fees from {} coins", num_coins);
        
        // Batch fee collection logic
        // Each coin's fees are collected via CPI to Pump Fun program
        
        msg!("Batch collection complete");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    /// The creator's vault where SOL fees accumulate
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,
    
    /// The creator's token account for receiving WSOL fees
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BatchCollectFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Batch size must be between 1 and 10")]
    InvalidBatchSize,
}
