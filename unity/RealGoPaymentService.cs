using System;
using System.Threading.Tasks;
using UnityEngine;
using Nethereum.Web3;
using Nethereum.ABI.FunctionEncoding.Attributes;
using Nethereum.Contracts;
using Nethereum.RPC.Eth.DTOs;
using System.Numerics;
using Nethereum.Hex.HexConvertors.Extensions;

namespace Web3Game.Payments
{
    /// <summary>
    /// Function message definition for ERC20 order payments.
    /// </summary>
    [Function("payOrderERC20")]
    public class PayOrderERC20Function : FunctionMessage
    {
        [Parameter("string", "orderId", 1)]
        public string OrderId { get; set; }

        [Parameter("string", "paymentId", 2)]
        public string PaymentId { get; set; }

        [Parameter("address", "token", 3)]
        public string Token { get; set; }

        [Parameter("uint256", "amount", 4)]
        public BigInteger Amount { get; set; }

        [Parameter("bytes", "signature", 5)]
        public byte[] Signature { get; set; }
    }

    /// <summary>
    /// Function message definition for Native (ETH/BNB/MATIC) order payments.
    /// </summary>
    [Function("payOrderNative")]
    public class PayOrderNativeFunction : FunctionMessage
    {
        [Parameter("string", "orderId", 1)]
        public string OrderId { get; set; }

        [Parameter("string", "paymentId", 2)]
        public string PaymentId { get; set; }

        [Parameter("bytes", "signature", 3)]
        public byte[] Signature { get; set; }
    }

    /// <summary>
    /// Service to handle Web3 game payments for the RealGoOrderPay smart contract.
    /// Supports both Whitelisted ERC20 and Native currency transactions.
    /// </summary>
    public class RealGoPaymentService
    {
        private readonly Web3 _web3;
        private readonly string _contractAddress;

        public RealGoPaymentService(Web3 web3, string contractAddress)
        {
            _web3 = web3 ?? throw new ArgumentNullException(nameof(web3));
            _contractAddress = contractAddress ?? throw new ArgumentNullException(nameof(contractAddress));
        }

        /// <summary>
        /// Executes an ERC20 token payment (e.g., USDT, USDC).
        /// Requires the user to have approved the contract to spend the specified amount first.
        /// </summary>
        /// <param name="orderId">Unique ID of the game order.</param>
        /// <param name="paymentId">Unique ID of the specific payment attempt.</param>
        /// <param name="tokenAddr">The ERC20 contract address.</param>
        /// <param name="amount">Human-readable amount (e.g., 10.5).</param>
        /// <param name="decimals">Token decimal places (e.g., 6 for USDT, 18 for most others).</param>
        /// <param name="sigHex">Hexadecimal signature string provided by the game backend.</param>
        /// <returns>Transaction receipt hash if successful, null otherwise.</returns>
        public async Task<string> PayWithERC20Async(string orderId, string paymentId, string tokenAddr, decimal amount, int decimals, string sigHex)
        {
            if (string.IsNullOrEmpty(sigHex)) throw new ArgumentException("Signature cannot be null or empty");

            // Convert human-readable decimal to blockchain BigInteger based on token decimals
            var multiplier = BigInteger.Pow(10, decimals);
            var amountInWei = new BigInteger(amount * (decimal)multiplier);

            var request = new PayOrderERC20Function
            {
                OrderId = orderId,
                PaymentId = paymentId,
                Token = tokenAddr,
                Amount = amountInWei,
                Signature = sigHex.HexToByteArray()
            };

            try
            {
                Debug.Log($"[Web3] Initiating ERC20 Payment for Order: {orderId}");
                var handler = _web3.Eth.GetContractTransactionHandler<PayOrderERC20Function>();
                
                // This will trigger the wallet provider (e.g., MetaMask/WalletConnect)
                var receipt = await handler.SendRequestAndWaitForReceiptAsync(_contractAddress, request);
                
                Debug.Log($"[Web3] Transaction Confirmed: {receipt.TransactionHash}");
                return receipt.TransactionHash;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Web3] ERC20 Payment Exception: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Executes a Native currency payment (e.g., ETH, BNB, MATIC).
        /// The value is sent directly with the transaction call.
        /// </summary>
        public async Task<string> PayWithNativeAsync(string orderId, string paymentId, decimal ethAmount, string sigHex)
        {
            if (string.IsNullOrEmpty(sigHex)) throw new ArgumentException("Signature cannot be null or empty");

            var request = new PayOrderNativeFunction
            {
                OrderId = orderId,
                PaymentId = paymentId,
                Signature = sigHex.HexToByteArray(),
                AmountToSend = Web3.Convert.ToWei(ethAmount)
            };

            try
            {
                Debug.Log($"[Web3] Initiating Native Payment for Order: {orderId} Value: {ethAmount}");
                var handler = _web3.Eth.GetContractTransactionHandler<PayOrderNativeFunction>();
                
                var receipt = await handler.SendRequestAndWaitForReceiptAsync(_contractAddress, request);
                
                Debug.Log($"[Web3] Transaction Confirmed: {receipt.TransactionHash}");
                return receipt.TransactionHash;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Web3] Native Payment Exception: {ex.Message}");
                return null;
            }
        }
    }
}
