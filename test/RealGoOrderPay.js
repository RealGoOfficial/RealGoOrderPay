import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre, { network } from "hardhat";
import { keccak256, encodePacked, parseUnits, parseEther, zeroAddress, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

describe("RealGoOrderPay", function () {
  const submitterPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const submitterAccount = privateKeyToAccount(submitterPrivateKey);

  async function deployFixture() {
    const { viem } = await network.connect();
    
    const [owner, treasury, user1, user2] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const chainId = await publicClient.getChainId();

    const mockToken = await viem.deployContract("MockERC20");

    const realGoOrderPay = await viem.deployContract("RealGoOrderPay", [
      owner.account.address,
      treasury.account.address,
      submitterAccount.address,
    ]);

    return {
      viem,
      realGoOrderPay,
      mockToken,
      owner,
      treasury,
      user1,
      user2,
      publicClient,
      chainId,
    };
  }

  describe("Deployment and Initialization", function () {
    it("Should set the correct initial state", async function () {
      const { realGoOrderPay, owner, treasury } = await deployFixture();
      assert.equal(await realGoOrderPay.read.owner(), getAddress(owner.account.address));
      assert.equal(await realGoOrderPay.read.treasury(), getAddress(treasury.account.address));
      assert.equal(await realGoOrderPay.read.submitter(), getAddress(submitterAccount.address));
      assert.equal(await realGoOrderPay.read.nativeAllowed(), false);
    });

    it("Should revert if treasury is zero address", async function () {
      const { viem, owner } = await deployFixture();
      await assert.rejects(
        viem.deployContract("RealGoOrderPay", [
          owner.account.address,
          zeroAddress,
          submitterAccount.address,
        ])
      );
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set native allowed", async function () {
      const { realGoOrderPay, publicClient } = await deployFixture();
      
      const hash = await realGoOrderPay.write.setNativeAllowed([true]);
      await publicClient.waitForTransactionReceipt({ hash });

      assert.equal(await realGoOrderPay.read.nativeAllowed(), true);
    });

    it("Should allow owner to set submitter", async function () {
      const { realGoOrderPay, user1, publicClient } = await deployFixture();
      
      const hash = await realGoOrderPay.write.setSubmitter([user1.account.address]);
      await publicClient.waitForTransactionReceipt({ hash });

      assert.equal(await realGoOrderPay.read.submitter(), getAddress(user1.account.address));
    });

    it("Should allow owner to add and remove token", async function () {
      const { realGoOrderPay, mockToken, publicClient } = await deployFixture();
      
      let hash = await realGoOrderPay.write.addToken([mockToken.address]);
      await publicClient.waitForTransactionReceipt({ hash });

      assert.equal(await realGoOrderPay.read.allowedTokens([mockToken.address]), true);

      const tokens = await realGoOrderPay.read.getAllowedTokens();
      assert.ok(tokens.map(t => t.toLowerCase()).includes(mockToken.address.toLowerCase()));

      hash = await realGoOrderPay.write.removeToken([mockToken.address]);
      await publicClient.waitForTransactionReceipt({ hash });

      assert.equal(await realGoOrderPay.read.allowedTokens([mockToken.address]), false);
    });

    it("Should not allow adding zero address token", async function () {
      const { realGoOrderPay } = await deployFixture();
      await assert.rejects(realGoOrderPay.write.addToken([zeroAddress]));
    });

    it("Should not allow adding an already allowed token", async function () {
      const { realGoOrderPay, mockToken, publicClient } = await deployFixture();
      const hash = await realGoOrderPay.write.addToken([mockToken.address]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      await assert.rejects(realGoOrderPay.write.addToken([mockToken.address]));
    });

    it("Should not allow removing unlisted token", async function () {
      const { realGoOrderPay, mockToken } = await deployFixture();
      await assert.rejects(realGoOrderPay.write.removeToken([mockToken.address]));
    });

    it("Should revert admin functions for non-owners", async function () {
      const { viem, realGoOrderPay, mockToken, user1 } = await deployFixture();
      
      const realGoOrderPayAsUser1 = await viem.getContractAt(
        "RealGoOrderPay",
        realGoOrderPay.address,
        { client: { wallet: user1 } }
      );

      await assert.rejects(realGoOrderPayAsUser1.write.setNativeAllowed([true]));
      await assert.rejects(realGoOrderPayAsUser1.write.addToken([mockToken.address]));
      await assert.rejects(realGoOrderPayAsUser1.write.setSubmitter([user1.account.address]));
    });
  });

  describe("ERC20 Payments", function () {
    const orderId = "order_123";
    const paymentId = "pay_456";
    const amount = parseUnits("100", 18);
    let chainId;

    async function setupPaymentFixture() {
      const context = await deployFixture();
      const { viem, realGoOrderPay, mockToken, user1, publicClient } = context;
      chainId = BigInt(context.chainId);
      
      let hash = await realGoOrderPay.write.addToken([mockToken.address]);
      await publicClient.waitForTransactionReceipt({ hash });

      hash = await mockToken.write.mint([user1.account.address, amount * 2n]);
      await publicClient.waitForTransactionReceipt({ hash });

      const mockTokenAsUser1 = await viem.getContractAt(
        "MockERC20",
        mockToken.address,
        { client: { wallet: user1 } }
      );
      hash = await mockTokenAsUser1.write.approve([realGoOrderPay.address, amount * 2n]);
      await publicClient.waitForTransactionReceipt({ hash });

      const realGoOrderPayAsUser1 = await viem.getContractAt(
        "RealGoOrderPay",
        realGoOrderPay.address,
        { client: { wallet: user1 } }
      );

      return { ...context, mockTokenAsUser1, realGoOrderPayAsUser1 };
    }

    async function getSignature(order, payment, tokenAddress, amt, account) {
      const messageHash = keccak256(
        encodePacked(
          ["uint256", "string", "string", "address", "uint256"],
          [chainId, order, payment, tokenAddress, amt]
        )
      );
      return await account.sign({ hash: messageHash });
    }

    it("Should successfully pay order with ERC20", async function () {
      const { realGoOrderPay, mockToken, treasury, realGoOrderPayAsUser1, publicClient } = await setupPaymentFixture();
      
      const signature = await getSignature(orderId, paymentId, mockToken.address, amount, submitterAccount);
      
      const hash = await realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, mockToken.address, amount, signature]);
      await publicClient.waitForTransactionReceipt({ hash });

      assert.equal(await realGoOrderPay.read.isPaid([orderId, paymentId]), true);
      assert.equal(await mockToken.read.balanceOf([treasury.account.address]), amount);
    });

    it("Should revert on invalid signature", async function () {
      const { realGoOrderPayAsUser1, mockToken } = await setupPaymentFixture();
      
      const wrongAccount = privateKeyToAccount("0x1234567890123456789012345678901234567890123456789012345678901234");
      const invalidSignature = await getSignature(orderId, paymentId, mockToken.address, amount, wrongAccount);

      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, mockToken.address, amount, invalidSignature])
      );
    });

    it("Should revert token payment if token not allowed", async function () {
      const { viem, realGoOrderPayAsUser1 } = await setupPaymentFixture();
      const unlistedToken = await viem.deployContract("MockERC20");

      const signature = await getSignature(orderId, paymentId, unlistedToken.address, amount, submitterAccount);

      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, unlistedToken.address, amount, signature])
      );
    });

    it("Should revert if an order is paid twice", async function () {
      const { realGoOrderPayAsUser1, mockToken, publicClient } = await setupPaymentFixture();
      
      const signature = await getSignature(orderId, paymentId, mockToken.address, amount, submitterAccount);
      
      const hash = await realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, mockToken.address, amount, signature]);
      await publicClient.waitForTransactionReceipt({ hash });

      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, mockToken.address, amount, signature])
      );
    });

    it("Should revert if allowance is insufficient", async function () {
      const { realGoOrderPayAsUser1, mockToken } = await setupPaymentFixture();
      const largeAmount = parseUnits("1000", 18); // We only approved 200
      
      const signature = await getSignature(orderId, paymentId, mockToken.address, largeAmount, submitterAccount);
      
      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderERC20([orderId, paymentId, mockToken.address, largeAmount, signature])
      );
    });
  });

  describe("Native Payments", function () {
    const orderId = "order_123_native";
    const paymentId = "pay_456_native";
    const amount = parseEther("1");
    let chainId;

    async function getNativeSignature(order, payment, amt, account) {
      const messageHash = keccak256(
        encodePacked(
          ["uint256", "string", "string", "uint256"],
          [chainId, order, payment, amt]
        )
      );
      return await account.sign({ hash: messageHash });
    }

    async function setupNativePaymentFixture() {
      const context = await deployFixture();
      const { viem, realGoOrderPay, user1 } = context;
      chainId = BigInt(context.chainId);
      
      const realGoOrderPayAsUser1 = await viem.getContractAt(
        "RealGoOrderPay",
        realGoOrderPay.address,
        { client: { wallet: user1 } }
      );
      
      return { ...context, realGoOrderPayAsUser1 };
    }

    it("Should successfully pay order with Native currency", async function () {
      const { realGoOrderPay, realGoOrderPayAsUser1, publicClient } = await setupNativePaymentFixture();
      
      const hash1 = await realGoOrderPay.write.setNativeAllowed([true]);
      await publicClient.waitForTransactionReceipt({ hash: hash1 });
      
      const signature = await getNativeSignature(orderId, paymentId, amount, submitterAccount);
      
      const hash2 = await realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, signature], { value: amount });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });
       
      assert.equal(await realGoOrderPay.read.isPaid([orderId, paymentId]), true);
    });

    it("Should revert on invalid signature", async function () {
      const { realGoOrderPay, realGoOrderPayAsUser1, publicClient } = await setupNativePaymentFixture();
      const hash1 = await realGoOrderPay.write.setNativeAllowed([true]);
      await publicClient.waitForTransactionReceipt({ hash: hash1 });
      
      const wrongAccount = privateKeyToAccount("0x1234567890123456789012345678901234567890123456789012345678901234");
      const invalidSignature = await getNativeSignature(orderId, paymentId, amount, wrongAccount);

      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, invalidSignature], { value: amount })
      );
    });

    it("Should revert native payment if not allowed", async function () {
      const { realGoOrderPayAsUser1 } = await setupNativePaymentFixture();
      
      const signature = await getNativeSignature(orderId, paymentId, amount, submitterAccount);
      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, signature], { value: amount })
      );
    });

    it("Should revert on zero native amount", async function () {
      const { realGoOrderPay, realGoOrderPayAsUser1, publicClient } = await setupNativePaymentFixture();
      
      const hash1 = await realGoOrderPay.write.setNativeAllowed([true]);
      await publicClient.waitForTransactionReceipt({ hash: hash1 });

      const signature = await getNativeSignature(orderId, paymentId, 0n, submitterAccount);
      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, signature], { value: 0n })
      );
    });

    it("Should revert if an order is paid twice natively", async function () {
      const { realGoOrderPay, realGoOrderPayAsUser1, publicClient } = await setupNativePaymentFixture();
      
      const hash1 = await realGoOrderPay.write.setNativeAllowed([true]);
      await publicClient.waitForTransactionReceipt({ hash: hash1 });
      
      const signature = await getNativeSignature(orderId, paymentId, amount, submitterAccount);
      
      const hash2 = await realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, signature], { value: amount });
      await publicClient.waitForTransactionReceipt({ hash: hash2 });
      
      await assert.rejects(
        realGoOrderPayAsUser1.write.payOrderNative([orderId, paymentId, signature], { value: amount })
      );
    });
  });

  describe("Rescue Functions", function () {
    it("Should rescue stuck ERC20 tokens", async function () {
      const { viem, realGoOrderPay, mockToken, treasury, user1, publicClient } = await deployFixture();
      const amount = parseUnits("50", 18);
      
      let hash = await mockToken.write.mint([user1.account.address, amount]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const mockTokenAsUser1 = await viem.getContractAt(
        "MockERC20",
        mockToken.address,
        { client: { wallet: user1 } }
      );
      hash = await mockTokenAsUser1.write.transfer([realGoOrderPay.address, amount]);
      await publicClient.waitForTransactionReceipt({ hash });

      const treasuryBalanceBefore = await mockToken.read.balanceOf([treasury.account.address]);
      
      hash = await realGoOrderPay.write.rescueToken([mockToken.address, amount]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const treasuryBalanceAfter = await mockToken.read.balanceOf([treasury.account.address]);

      assert.equal(treasuryBalanceAfter - treasuryBalanceBefore, amount);
    });

    it("Should rescue stuck Native currency", async function () {
      const { viem, realGoOrderPay, treasury, publicClient } = await deployFixture();
      const amount = parseEther("1");
      
      const testClient = await viem.getTestClient();
      await testClient.setBalance({
        address: realGoOrderPay.address,
        value: amount,
      });

      const treasuryBalanceBefore = await publicClient.getBalance({ address: treasury.account.address });
      
      const hash = await realGoOrderPay.write.rescueNative([amount]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const treasuryBalanceAfter = await publicClient.getBalance({ address: treasury.account.address });

      assert.equal(treasuryBalanceAfter - treasuryBalanceBefore, amount);
    });
    
    it("Should revert rescue functions for non-owners", async function () {
      const { viem, realGoOrderPay, user1 } = await deployFixture();
      
      const realGoOrderPayAsUser1 = await viem.getContractAt(
        "RealGoOrderPay",
        realGoOrderPay.address,
        { client: { wallet: user1 } }
      );

      await assert.rejects(realGoOrderPayAsUser1.write.rescueNative([100n]));
    });
  });
});
