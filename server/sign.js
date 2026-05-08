const { ethers } = require("ethers");

/**
 * Generates a signature for the RealGoOrderPay contract
 */
async function generatePaymentSignature() {
    // 1. Setup (In production, use environment variables for the private key!)
    const privateKey = "0xYOUR_SUBMITTER_PRIVATE_KEY";
    const wallet = new ethers.Wallet(privateKey);

    // 2. Payment Details (Must match what is sent to the contract)
    const paymentData = {
        chainId: 137,               // e.g., Polygon Mainnet
        orderId: "ORDER_1001",
        paymentId: "PAY_999",
        token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT address
        amount: ethers.parseUnits("10.5", 6)                 // 10.5 USDT (6 decimals)
    };

    // 3. Create Message Hash (Mirroring Solidity's keccak256(abi.encodePacked(...)))
    // Note: Solidity's encodePacked for strings/bytes vs ethers.solidityPacked
    const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "string", "string", "address", "uint256"],
        [
            paymentData.chainId,
            paymentData.orderId,
            paymentData.paymentId,
            paymentData.token,
            paymentData.amount
        ]
    );

    // 4. Sign the Hash
    // Note: signMessage adds the "\x19Ethereum Signed Message:\n" prefix which ECDSA.recover expects
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    console.log("--- Payment Signature Data ---");
    console.log(`OrderId:   ${paymentData.orderId}`);
    console.log(`Amount:    ${paymentData.amount.toString()}`);
    console.log(`Signature: ${signature}`);
    
    return signature;
}

generatePaymentSignature();
