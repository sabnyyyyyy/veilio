'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ServicesNav from '@/components/services/ServicesNav';
import { useAccount, useWriteContract, usePublicClient, useSwitchChain, useSignMessage, useBalance } from 'wagmi';
import { parseEther, formatEther, stringToHex, pad } from 'viem';
import {
  VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS,
  VEIL_SERVICE_ESCROW_ABI,
  getServiceEscrowAddress,
} from '@/lib/serviceContract';
import { createServiceAuthMessage, generateAuthNonce } from '@/lib/serviceAuth';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  MessageSquare,
  ArrowLeft,
  Loader2,
  Send,
  RotateCcw,
  ExternalLink,
  Lock,
  Coins,
  XCircle,
  Check,
  Wallet,
} from 'lucide-react';
import type { ServiceOrder, OrderSubmission, OrderRevision, ServiceDispute } from '@/lib/server/servicesDb';
import DisputeResolutionPanel from '@/components/services/DisputeResolutionPanel';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  findEscrowOrderPda,
  findVaultPda,
  createDepositServiceOrderInstruction,
  createSubmitDeliveryInstruction,
  createReleaseFundsInstruction,
  createCancelOrRefundInstruction,
  getSolanaServiceEscrowProgramId,
  getSolanaServiceFeeRecipient,
  getSolanaServiceReviewer,
  parseSolToLamports,
  toSolanaEscrowOrderIdHex,
} from '@/lib/cross-chain/solanaServiceEscrow';
import { saveServiceActivity } from '@/lib/walletStorage';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { data: balanceData } = useBalance({ address });

  const orderId = String(params.id);

  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [submissions, setSubmissions] = useState<OrderSubmission[]>([]);
  const [revisions, setRevisions] = useState<OrderRevision[]>([]);
  const [dispute, setDispute] = useState<ServiceDispute | null>(null);

  // Direct Solana Injected Wallet (Phantom, Solflare, etc.) State
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [isPhantomDetected, setIsPhantomDetected] = useState<boolean>(false);
  const [solanaConnecting, setSolanaConnecting] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Live On-Chain Transaction Progress State
  type TxStage = 'idle' | 'awaiting_wallet' | 'mining' | 'verifying' | 'confirmed' | 'failed';
  const [txStage, setTxStage] = useState<TxStage>('idle');
  const [activeTxHash, setActiveTxHash] = useState<string | null>(null);
  const [txActionLabel, setTxActionLabel] = useState<string>('');
  const [txErrorMessage, setTxErrorMessage] = useState<string | null>(null);
  const [txSuccessMessage, setTxSuccessMessage] = useState<string | null>(null);

  // Deposit Action State
  const [depositing, setDepositing] = useState(false);

  // Seller Submission State
  const [subDescription, setSubDescription] = useState('');
  const [subDeliverableRef, setSubDeliverableRef] = useState('');
  const [submittingWork, setSubmittingWork] = useState(false);

  // Buyer Revision State
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [requestingRevision, setRequestingRevision] = useState(false);

  // Buyer Approval State
  const [approving, setApproving] = useState(false);

  // Detect injected Solana wallet (Phantom) on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const provider = (window as any).solana;
      if (provider) {
        setIsPhantomDetected(true);
        if (provider.publicKey) {
          setSolanaAddress(provider.publicKey.toString());
        }
        const handleAccountChange = (pk: any) => {
          setSolanaAddress(pk ? pk.toString() : null);
        };
        provider.on?.('accountChanged', handleAccountChange);
        return () => {
          provider.removeListener?.('accountChanged', handleAccountChange);
        };
      }
    }
  }, []);

  const connectSolanaWallet = async () => {
    if (typeof window === 'undefined' || !(window as any).solana) {
      alert('Phantom or a compatible Solana wallet is not detected. Please install Phantom from https://phantom.app.');
      return;
    }
    try {
      setSolanaConnecting(true);
      const res = await (window as any).solana.connect();
      const pubkey = res.publicKey.toString();
      setSolanaAddress(pubkey);
    } catch (err: any) {
      console.error('Failed to connect Solana wallet:', err);
    } finally {
      setSolanaConnecting(false);
    }
  };

  // The server returns the authoritative order.network; currency is only a legacy fallback.
  const isBaseOrder = order?.network ? order.network === 'base:84532' : order?.currency === 'ETH';
  const isSolanaOrder = order?.network ? order.network === 'solana:devnet' : order?.currency === 'SOL';
  const expectedChainId = isBaseOrder ? 84532 : 97;
  const expectedNetworkName = isBaseOrder ? 'Base Sepolia (Chain ID 84532)' : isSolanaOrder ? 'Solana Devnet' : 'BNB Chain Testnet (Chain ID 97)';
  const networkDisplayName = isBaseOrder ? 'Base Sepolia' : isSolanaOrder ? 'Solana Devnet' : 'BNB Chain Testnet';
  const currencyLabel = isBaseOrder ? 'ETH' : isSolanaOrder ? 'SOL' : 'tBNB';
  const targetEscrowAddress = getServiceEscrowAddress(expectedChainId);

  // Convert string orderId into bytes32
  const getBytes32OrderId = (idStr: string) => {
    try {
      const hex = stringToHex(idStr);
      return pad(hex, { size: 32, dir: 'right' });
    } catch {
      return '0x' + Buffer.from(idStr.padEnd(32, '\0')).toString('hex');
    }
  };

  const getTxExplorerUrl = (tx: string) => {
    if (isBaseOrder) return `https://sepolia.basescan.org/tx/${tx}`;
    if (isSolanaOrder) return `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
    return `https://testnet.bscscan.com/tx/${tx}`;
  };

  const getAddressExplorerUrl = (addr: string) => {
    if (isBaseOrder) return `https://sepolia.basescan.org/address/${addr}`;
    if (isSolanaOrder) return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
    return `https://testnet.bscscan.com/address/${addr}`;
  };

  const getExplorerName = () => {
    if (isBaseOrder) return 'BaseScan';
    if (isSolanaOrder) return 'Solana Explorer';
    return 'BscScan';
  };

  const sendSolanaTx = async (instruction: {
    programId: string;
    keys?: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    accounts?: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: Buffer | Uint8Array;
  }): Promise<string> => {
    const provider = (window as any).solana;
    if (!provider || !provider.publicKey) {
      throw new Error('Please connect your Solana wallet (Phantom).');
    }
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const accountsList = instruction.keys || instruction.accounts || [];
    const txInstruction = new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: accountsList.map((k) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(instruction.data),
    });

    const tx = new Transaction().add(txInstruction);
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = new PublicKey(provider.publicKey.toString());

    let signature = '';
    if (provider.signAndSendTransaction) {
      const res = await provider.signAndSendTransaction(tx);
      signature = res.signature;
    } else if (provider.signTransaction) {
      const signed = await provider.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize());
    } else {
      throw new Error('Connected Solana wallet cannot sign transactions.');
    }

    setTxStage('mining');
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      'confirmed'
    );
    return signature;
  };

  const signAuthMessage = async (action: string) => {
    const callerAddress = isSolanaOrder ? solanaAddress : address;
    if (!callerAddress) throw new Error('No active wallet connected for signing.');

    const authTimestamp = Date.now();
    const authNonce = generateAuthNonce();
    const authMessage = createServiceAuthMessage({
      action,
      orderId,
      address: callerAddress,
      timestamp: authTimestamp,
      nonce: authNonce,
    });

    let signature = '';
    if (isSolanaOrder) {
      const provider = (window as any).solana;
      if (!provider?.signMessage) throw new Error('Solana wallet does not support message signing.');
      const encoded = new TextEncoder().encode(authMessage);
      const res = await provider.signMessage(encoded, 'utf8');
      const sigBytes = res.signature || res;
      signature = '0x' + Buffer.from(sigBytes).toString('hex');
    } else {
      signature = await signMessageAsync({ message: authMessage });
    }

    return {
      address: callerAddress,
      signature,
      timestamp: authTimestamp,
      nonce: authNonce,
    };
  };

  const fetchOrderData = async () => {
    try {
      setLoading(true);
      const callerAddress = (isSolanaOrder && solanaAddress) ? solanaAddress : (address || solanaAddress);
      if (!callerAddress) {
        setOrder(null);
        setSubmissions([]);
        setRevisions([]);
        setDispute(null);
        return;
      }

      const authTimestamp = Date.now();
      const authNonce = generateAuthNonce();
      const authMessage = createServiceAuthMessage({
        action: 'read-order',
        orderId,
        address: callerAddress,
        timestamp: authTimestamp,
        nonce: authNonce,
      });

      let signature = '';
      if (solanaAddress && callerAddress === solanaAddress) {
        const provider = (window as any).solana;
        if (provider?.signMessage) {
          const res = await provider.signMessage(new TextEncoder().encode(authMessage), 'utf8');
          const sigBytes = res.signature || res;
          signature = '0x' + Buffer.from(sigBytes).toString('hex');
        }
      } else if (address) {
        signature = await signMessageAsync({ message: authMessage });
      }

      const orderRes = await fetch(`/api/orders/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          auth: { address: callerAddress, signature, timestamp: authTimestamp, nonce: authNonce },
        }),
      });

      const data = await orderRes.json();
      if (data.success && data.order) {
        setOrder(data.order);
        setSubmissions(data.submissions || []);
        setRevisions(data.revisions || []);
        setDispute(data.dispute || null);
      } else {
        setOrder(null);
        setSubmissions([]);
        setRevisions([]);
        setDispute(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) fetchOrderData();
  }, [orderId, address, solanaAddress]);

  // Buyer deposits funds into on-chain escrow
  const handleDepositEscrow = async () => {
    if (!order) return;
    if (isSolanaOrder) {
      // Prevent EVM client from submitting Solana transactions
      if (!solanaAddress || typeof window === 'undefined' || !(window as any).solana) {
        setTxErrorMessage('This order is on Solana Devnet. Please connect Phantom or an injected Solana wallet. EVM wallets (MetaMask/Rabby) cannot execute Solana transactions.');
        setTxStage('failed');
        return;
      }

      try {
        setDepositing(true);
        setTxActionLabel('Solana Escrow Deposit');
        setTxStage('awaiting_wallet');
        setTxErrorMessage(null);
        setTxSuccessMessage(null);
        setActiveTxHash(null);

        const solProgramId = getSolanaServiceEscrowProgramId();
        const feeRecipient = getSolanaServiceFeeRecipient();
        // The dispute reviewer must be the platform reviewer wallet (a program id cannot
        // sign resolve_dispute). The server rejects deposits naming any other reviewer.
        const reviewer = getSolanaServiceReviewer();
        if (!reviewer) {
          throw new Error('Solana escrow is not configured: NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER (platform dispute reviewer wallet) is not set. Deposit aborted.');
        }
        const amountLamports = parseSolToLamports(String(order.priceSnapshot));
        const deadlineSec = Math.floor(order.deadline / 1000);

        const ix = createDepositServiceOrderInstruction({
          programId: solProgramId,
          buyer: solanaAddress,
          seller: order.sellerId,
          reviewer,
          feeRecipient,
          orderId: toSolanaEscrowOrderIdHex(order.id),
          amountLamports,
          deadline: deadlineSec,
        });

        const txSig = await sendSolanaTx(ix);
        setActiveTxHash(txSig);

        setTxStage('verifying');
        const authData = await signAuthMessage('verify-deposit');

        const res = await fetch(`/api/orders/${order.id}/verify-deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txHash: txSig,
            buyerAddress: solanaAddress,
            auth: authData,
          }),
        });

        const data = await res.json();
        if (data.success && data.order) {
          setOrder(data.order);
          setTxStage('confirmed');
          setTxSuccessMessage(`Funds successfully deposited on Solana Devnet! Signature: ${txSig.slice(0, 10)}...${txSig.slice(-8)}`);
          if (solanaAddress) {
            saveServiceActivity({
              id: `act_deposit_${order.id}_${Date.now()}`,
              type: 'service_order_funded',
              orderId: order.id,
              title: order.serviceTitle || `Service Order #${order.id}`,
              amount: String(order.priceSnapshot),
              currency: 'SOL',
              userAddress: solanaAddress,
              role: 'buyer',
              txHash: txSig,
              networkId: 'solana:devnet',
              timestamp: Date.now(),
              status: 'InProgress',
              isOnChainConfirmed: true,
            });
          }
          fetchOrderData();
        } else {
          throw new Error(data.error || 'Server failed to verify Solana deposit receipt');
        }
      } catch (err: any) {
        console.error('Solana deposit error:', err);
        const isRejection = err.message?.includes('User rejected') || err.message?.includes('rejected');
        setTxStage('failed');
        setTxErrorMessage(isRejection ? 'Transaction cancelled in Phantom wallet.' : (err.message || 'Solana deposit transaction failed.'));
      } finally {
        setDepositing(false);
      }
      return;
    }

    // EVM Deposit Flow (BNB Chain / Base Sepolia)
    if (!order || !address) {
      setTxErrorMessage('Please connect your Web3 wallet first (MetaMask or Rabby).');
      setTxStage('failed');
      return;
    }

    if (chainId && chainId !== expectedChainId) {
      setTxErrorMessage(`Please switch your wallet network to ${expectedNetworkName} before depositing.`);
      setTxStage('failed');
      return;
    }

    if (balanceData && Number(formatEther(balanceData.value)) < Number(order.priceSnapshot)) {
      setTxErrorMessage(`Insufficient balance: your wallet holds ${parseFloat(formatEther(balanceData.value)).toFixed(4)} ${currencyLabel}, but ${order.priceSnapshot} ${currencyLabel} is required for this escrow deposit.`);
      setTxStage('failed');
      return;
    }

    try {
      setDepositing(true);
      setTxActionLabel('Escrow Deposit');
      setTxStage('awaiting_wallet');
      setTxErrorMessage(null);
      setTxSuccessMessage(null);
      setActiveTxHash(null);

      const orderBytes32 = getBytes32OrderId(order.id);
      const deadlineBigInt = BigInt(Math.floor(order.deadline / 1000));
      const amountWei = parseEther(order.priceSnapshot);

      const txHash = await writeContractAsync({
        address: targetEscrowAddress,
        abi: VEIL_SERVICE_ESCROW_ABI,
        functionName: 'deposit',
        args: [orderBytes32, order.sellerId as `0x${string}`, deadlineBigInt],
        value: amountWei,
      });

      setActiveTxHash(txHash);
      setTxStage('mining');

      if (publicClient && txHash) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
        if (receipt.status !== 'success') {
          throw new Error(`On-chain deposit transaction reverted on ${expectedNetworkName}.`);
        }
      }

      setTxStage('verifying');
      const authData = await signAuthMessage('verify-deposit');

      // Verify and record deposit on server
      const res = await fetch(`/api/orders/${order.id}/verify-deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash,
          onChainOrderId: orderBytes32,
          buyerAddress: address,
          network: isBaseOrder ? 'base:84532' : 'bnb:97',
          auth: authData,
        }),
      });

      const data = await res.json();
      if (data.success && data.order) {
        setOrder(data.order);
        setTxStage('confirmed');
        setTxSuccessMessage(`Funds successfully deposited into VeilServiceEscrow on ${expectedNetworkName}! Escrow status is now Funded.`);
        if (address) {
          saveServiceActivity({
            id: `act_deposit_${order.id}_${Date.now()}`,
            type: 'service_order_funded',
            orderId: order.id,
            title: order.serviceTitle || `Service Order #${order.id}`,
            amount: String(order.priceSnapshot),
            currency: currencyLabel,
            userAddress: address,
            role: 'buyer',
            txHash: txHash as string,
            networkId: isBaseOrder ? 'base:84532' : 'bnb:97',
            timestamp: Date.now(),
            status: 'InProgress',
            isOnChainConfirmed: true,
          });
        }
        fetchOrderData();
      } else {
        throw new Error(data.error || 'Server failed to verify deposit receipt');
      }
    } catch (err: any) {
      console.error('Deposit error:', err);
      const isRejection = err.message?.includes('User rejected') || err.code === 4001;
      const isInsufficient = err.message?.includes('insufficient funds');
      setTxStage('failed');
      if (isRejection) {
        setTxErrorMessage('Transaction cancelled: request was rejected in your wallet.');
      } else if (isInsufficient) {
        setTxErrorMessage(`Insufficient gas or funds in your wallet to cover the deposit value and fee on ${networkDisplayName}.`);
      } else {
        setTxErrorMessage(err.shortMessage || err.message || 'Deposit transaction failed.');
      }
    } finally {
      setDepositing(false);
    }
  };

  // Seller submits work
  const handleSubmitDeliverables = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveAddress = isSolanaOrder ? solanaAddress : address;
    if (!order || !effectiveAddress || !subDescription.trim()) return;

    try {
      setSubmittingWork(true);
      const deliverableRef = subDeliverableRef.trim() || `order-${order.id}-deliverables`;

      // Mandatory on-chain delivery registration. Errors are NOT swallowed: if the escrow
      // is not marked Delivered on-chain, the buyer could still claim a timeout refund.
      let deliveryTx: string;
      if (isSolanaOrder) {
        const ix = createSubmitDeliveryInstruction({
          programId: getSolanaServiceEscrowProgramId(),
          seller: effectiveAddress,
          orderId: toSolanaEscrowOrderIdHex(order.id),
          deliverableReference: deliverableRef,
        });
        deliveryTx = await sendSolanaTx(ix);
        setActiveTxHash(deliveryTx);
      } else {
        if (chainId && chainId !== expectedChainId) {
          throw new Error(`Please switch your wallet network to ${expectedNetworkName} before submitting.`);
        }
        const orderBytes32 = getBytes32OrderId(order.id);
        deliveryTx = await writeContractAsync({
          address: targetEscrowAddress,
          abi: VEIL_SERVICE_ESCROW_ABI,
          functionName: 'submitDelivery',
          args: [orderBytes32, deliverableRef],
        });
        setActiveTxHash(deliveryTx);
        if (publicClient && deliveryTx) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: deliveryTx as `0x${string}` });
          if (receipt.status !== 'success') {
            throw new Error('On-chain submitDelivery transaction reverted.');
          }
        }
      }

      // Sign authentication payload
      const authData = await signAuthMessage('submit');

      const res = await fetch(`/api/orders/${order.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerAddress: effectiveAddress,
          description: subDescription.trim(),
          deliverableReferences: subDeliverableRef.trim() ? [subDeliverableRef.trim()] : [],
          deliveryTxHash: deliveryTx,
          auth: authData,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSubDescription('');
        setSubDeliverableRef('');
        fetchOrderData();
        alert('Deliverables successfully submitted for buyer review!');
      } else {
        alert(data.error || 'Failed to submit work');
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Submission failed');
    } finally {
      setSubmittingWork(false);
    }
  };

  // Buyer requests revision
  const handleRequestRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveAddress = isSolanaOrder ? solanaAddress : address;
    if (!order || !effectiveAddress || !revisionFeedback.trim()) return;

    try {
      setRequestingRevision(true);
      const authData = await signAuthMessage('revision');

      const res = await fetch(`/api/orders/${order.id}/revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress: effectiveAddress,
          feedback: revisionFeedback.trim(),
          auth: authData,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowRevisionForm(false);
        setRevisionFeedback('');
        fetchOrderData();
        alert('Revision request sent to provider.');
      } else {
        alert(data.error || 'Failed to request revision');
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Revision request failed');
    } finally {
      setRequestingRevision(false);
    }
  };

  // Buyer approves work and releases funds
  const handleApproveWork = async () => {
    const effectiveAddress = isSolanaOrder ? solanaAddress : address;
    if (!order || !effectiveAddress) return;

    if (!confirm('Are you sure you want to approve this work? This will release escrow funds to the seller on-chain (95% to seller, 5% platform fee).')) return;

    if (isSolanaOrder) {
      try {
        setApproving(true);
        setTxActionLabel('Release Escrow Funds (Solana Devnet)');
        setTxStage('awaiting_wallet');
        setTxErrorMessage(null);
        setTxSuccessMessage(null);
        setActiveTxHash(null);

        const ix = createReleaseFundsInstruction({
          programId: getSolanaServiceEscrowProgramId(),
          buyer: effectiveAddress,
          seller: order.sellerId,
          feeRecipient: getSolanaServiceFeeRecipient(),
          orderId: toSolanaEscrowOrderIdHex(order.id),
        });

        const txSig = await sendSolanaTx(ix);
        setActiveTxHash(txSig);

        setTxStage('verifying');
        const authData = await signAuthMessage('approve');

        const res = await fetch(`/api/orders/${order.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buyerAddress: effectiveAddress,
            releaseTxHash: txSig,
            auth: authData,
          }),
        });

        const data = await res.json();
        if (data.success && data.order) {
          setOrder(data.order);
          setTxStage('confirmed');
          setTxSuccessMessage(`Work approved! Payout released to seller on Solana Devnet. Tx: ${txSig.slice(0, 10)}...${txSig.slice(-8)}`);
          if (effectiveAddress) {
            saveServiceActivity({
              id: `act_release_${order.id}_${Date.now()}`,
              type: 'service_order_completed',
              orderId: order.id,
              title: order.serviceTitle || `Service Order #${order.id}`,
              amount: String(order.priceSnapshot),
              currency: 'SOL',
              userAddress: effectiveAddress,
              role: 'buyer',
              txHash: txSig,
              networkId: 'solana:devnet',
              timestamp: Date.now(),
              status: 'Completed',
              isOnChainConfirmed: true,
            });
          }
          fetchOrderData();
        } else {
          throw new Error(data.error || 'Server failed to verify Solana release transaction');
        }
      } catch (err: any) {
        console.error('Solana approval error:', err);
        const isRejection = err.message?.includes('User rejected') || err.message?.includes('rejected');
        setTxStage('failed');
        setTxErrorMessage(isRejection ? 'Transaction cancelled in Phantom wallet.' : (err.message || 'Approval failed.'));
      } finally {
        setApproving(false);
      }
      return;
    }

    // EVM Flow
    if (chainId && chainId !== expectedChainId) {
      setTxErrorMessage(`Please switch your wallet network to ${expectedNetworkName} before releasing funds.`);
      setTxStage('failed');
      return;
    }

    try {
      setApproving(true);
      setTxActionLabel('Release Escrow Funds');
      setTxStage('awaiting_wallet');
      setTxErrorMessage(null);
      setTxSuccessMessage(null);
      setActiveTxHash(null);

      const orderBytes32 = getBytes32OrderId(order.id);

      const releaseTxHash = await writeContractAsync({
        address: targetEscrowAddress,
        abi: VEIL_SERVICE_ESCROW_ABI,
        functionName: 'releaseFunds',
        args: [orderBytes32],
      });

      setActiveTxHash(releaseTxHash);
      setTxStage('mining');

      if (publicClient && releaseTxHash) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: releaseTxHash });
        if (receipt.status !== 'success') {
          throw new Error('On-chain release transaction failed or was reverted.');
        }
      }

      setTxStage('verifying');
      const authData = await signAuthMessage('approve');

      const res = await fetch(`/api/orders/${order.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAddress: address,
          releaseTxHash,
          auth: authData,
        }),
      });

      const data = await res.json();
      if (data.success && data.order) {
        setOrder(data.order);
        setTxStage('confirmed');
        setTxSuccessMessage('Work approved! 95% payout released to seller, 5% fee sent to platform on-chain.');
        if (address) {
          saveServiceActivity({
            id: `act_release_${order.id}_${Date.now()}`,
            type: 'service_order_completed',
            orderId: order.id,
            title: order.serviceTitle || `Service Order #${order.id}`,
            amount: String(order.priceSnapshot),
            currency: currencyLabel,
            userAddress: address,
            role: 'buyer',
            txHash: activeTxHash || undefined,
            networkId: isBaseOrder ? 'base:84532' : 'bnb:97',
            timestamp: Date.now(),
            status: 'Completed',
            isOnChainConfirmed: true,
          });
        }
        fetchOrderData();
      } else {
        throw new Error(data.error || 'Server failed to verify release transaction');
      }
    } catch (err: any) {
      console.error('Approval error:', err);
      const isRejection = err.message?.includes('User rejected') || err.code === 4001;
      setTxStage('failed');
      setTxErrorMessage(isRejection ? 'Transaction cancelled in wallet.' : (err.shortMessage || err.message || 'Approval failed'));
    } finally {
      setApproving(false);
    }
  };

  // Seller Cancellation or Buyer Timeout Refund
  const [cancelling, setCancelling] = useState(false);
  const handleCancelOrder = async () => {
    const effectiveAddress = isSolanaOrder ? solanaAddress : address;
    if (!order || !effectiveAddress) return;

    const isBuyerTimeout = isBuyer && Date.now() > order.deadline;
    const actionLabel = isSeller ? 'Cancel Order & Refund Buyer' : 'Claim Timeout Refund';
    const reasonPrompt = isSeller
      ? prompt('Please enter the cancellation reason for the buyer:')
      : 'Buyer claimed timeout refund after delivery deadline expired without deliverables.';

    if (isSeller && reasonPrompt === null) return;
    if (!confirm(`Are you sure you want to execute ${actionLabel}? 100% of escrow funds will be returned to the buyer fee-free.`)) return;

    if (isSolanaOrder) {
      try {
        setCancelling(true);
        setTxActionLabel(actionLabel);
        setTxStage('awaiting_wallet');
        setTxErrorMessage(null);
        setTxSuccessMessage(null);
        setActiveTxHash(null);

        let txSig = '';
        if (order.paymentStatus === 'Funded') {
          const ix = createCancelOrRefundInstruction({
            programId: getSolanaServiceEscrowProgramId(),
            caller: effectiveAddress,
            buyer: order.buyerId,
            orderId: toSolanaEscrowOrderIdHex(order.id),
            reason: reasonPrompt || 'Order cancelled',
          });
          txSig = await sendSolanaTx(ix);
          setActiveTxHash(txSig);
        }

        setTxStage('verifying');
        const authData = await signAuthMessage('cancel');

        const res = await fetch(`/api/orders/${order.id}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callerAddress: effectiveAddress,
            reason: reasonPrompt,
            txHash: txSig || undefined,
            auth: authData,
          }),
        });

        const data = await res.json();
        if (data.success && data.order) {
          setOrder(data.order);
          setTxStage('confirmed');
          setTxSuccessMessage(`Order cancelled and 100% fee-free refund confirmed on Solana Devnet.`);
          fetchOrderData();
        } else {
          throw new Error(data.error || 'Server failed to verify Solana cancellation');
        }
      } catch (err: any) {
        console.error('Solana cancellation error:', err);
        const isRejection = err.message?.includes('User rejected') || err.message?.includes('rejected');
        setTxStage('failed');
        setTxErrorMessage(isRejection ? 'Transaction cancelled in Phantom wallet.' : (err.message || 'Cancellation failed.'));
      } finally {
        setCancelling(false);
      }
      return;
    }

    // EVM Flow
    if (chainId && chainId !== expectedChainId) {
      setTxErrorMessage(`Please switch your wallet network to ${expectedNetworkName} before cancelling.`);
      setTxStage('failed');
      return;
    }

    try {
      setCancelling(true);
      setTxActionLabel(actionLabel);
      setTxStage('awaiting_wallet');
      setTxErrorMessage(null);
      setTxSuccessMessage(null);
      setActiveTxHash(null);

      const orderBytes32 = getBytes32OrderId(order.id);
      let txHash = '';

      if (order.paymentStatus === 'Funded') {
        txHash = await writeContractAsync({
          address: targetEscrowAddress,
          abi: VEIL_SERVICE_ESCROW_ABI,
          functionName: 'cancelOrder',
          args: [orderBytes32, reasonPrompt || 'Order cancelled'],
        });

        setActiveTxHash(txHash);
        setTxStage('mining');

        if (publicClient && txHash) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
          if (receipt.status !== 'success') {
            throw new Error('On-chain cancellation transaction reverted.');
          }
        }
      }

      setTxStage('verifying');
      const authData = await signAuthMessage('cancel');

      const res = await fetch(`/api/orders/${order.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerAddress: address,
          reason: reasonPrompt,
          txHash: txHash || undefined,
          auth: authData,
        }),
      });

      const data = await res.json();
      if (data.success && data.order) {
        setOrder(data.order);
        setTxStage('confirmed');
        setTxSuccessMessage(`Order successfully ${data.order.status.toLowerCase()} and 100% fee-free refund confirmed on-chain.`);
        fetchOrderData();
      } else {
        throw new Error(data.error || 'Server failed to verify cancellation transaction');
      }
    } catch (err: any) {
      console.error('Cancellation error:', err);
      const isRejection = err.message?.includes('User rejected') || err.code === 4001;
      setTxStage('failed');
      setTxErrorMessage(isRejection ? 'Transaction cancelled in wallet.' : (err.shortMessage || err.message || 'Cancellation failed'));
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full min-h-[50vh] flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-[#C9A45C] animate-spin" />
      </div>
    );
  }

  const activeUserAddress = isSolanaOrder ? solanaAddress : address;
  const hasConnectedWallet = Boolean(solanaAddress || address);

  if (!order) {
    return (
      <div className="w-full max-w-xl mx-auto p-12 text-center space-y-4">
        <h2 className="text-xl font-bold text-rose-400">{!hasConnectedWallet ? 'Connect your wallet to view this order' : 'Order Not Found'}</h2>
        {!hasConnectedWallet && (
          <div className="space-y-4">
            <p className="text-sm text-[#A8A397]">Connect your wallet to authenticate and access this escrow order.</p>
            {isPhantomDetected && !solanaAddress && (
              <button
                onClick={connectSolanaWallet}
                disabled={solanaConnecting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#AB9FF2] to-[#9945FF] text-white font-bold rounded-xl text-xs hover:opacity-90 transition-opacity"
              >
                <Wallet className="w-4 h-4" />
                <span>{solanaConnecting ? 'Connecting Phantom...' : 'Connect Phantom (Solana)'}</span>
              </button>
            )}
          </div>
        )}
        <Link href="/services/orders" className="text-xs text-[#C9A45C] underline block pt-2">
          Back to Orders
        </Link>
      </div>
    );
  }

  const isBuyer = Boolean(activeUserAddress && activeUserAddress.toLowerCase() === order.buyerId.toLowerCase());
  const isSeller = Boolean(activeUserAddress && activeUserAddress.toLowerCase() === order.sellerId.toLowerCase());

  // Progress Stepper calculation
  const getStepIndex = () => {
    if (order.status === 'Completed') return 4;
    if (order.status === 'InReview') return 3;
    if (order.status === 'InProgress' || order.status === 'RevisionRequested') return 2;
    if (order.status === 'Funded') return 2;
    return 1; // AwaitingPayment
  };

  const currentStep = getStepIndex();

  return (
    <div className="w-full pb-20 selection:bg-[#C9A45C]/30">
      <ServicesNav />

      {isConnected && !isSolanaOrder && chainId && chainId !== expectedChainId && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                <strong>Network Mismatch:</strong> Your wallet is connected to Chain ID {chainId}. Please switch to {networkDisplayName} (Chain ID {expectedChainId}) to interact with this escrow contract.
              </span>
            </div>
            {switchChain && (
              <button
                onClick={() => switchChain({ chainId: expectedChainId })}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-[#0A0A09] font-bold rounded-lg transition-colors text-xs whitespace-nowrap"
              >
                Switch to {networkDisplayName}
              </button>
            )}
          </div>
        </div>
      )}

      {isSolanaOrder && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4">
          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Wallet className="w-4 h-4 shrink-0 text-purple-400" />
              <div>
                <span>
                  <strong>Solana Devnet Escrow:</strong> {solanaAddress ? (
                    <>Connected with <span className="font-mono text-purple-300">{solanaAddress.slice(0, 6)}...{solanaAddress.slice(-4)}</span></>
                  ) : (
                    'Connect Phantom or an injected Solana wallet to interact with this order.'
                  )}
                </span>
                {isConnected && (
                  <span className="block text-[11px] text-[#A8A397] mt-0.5">
                    EVM wallet ({address?.slice(0, 6)}...{address?.slice(-4)}) active for other networks — EVM clients are prevented from submitting Solana escrow transactions.
                  </span>
                )}
              </div>
            </div>
            {!solanaAddress && (
              <button
                onClick={connectSolanaWallet}
                disabled={solanaConnecting}
                className="px-3.5 py-1.5 bg-gradient-to-r from-[#AB9FF2] to-[#9945FF] text-white font-bold rounded-lg transition-opacity hover:opacity-90 text-xs whitespace-nowrap"
              >
                {solanaConnecting ? 'Connecting...' : isPhantomDetected ? 'Connect Phantom' : 'Install Phantom'}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-8">
          <Link
            href="/services/orders"
            className="inline-flex items-center gap-2 text-xs text-[#A8A397] hover:text-[#C9A45C] transition-colors font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to My Orders</span>
          </Link>

          {/* Header Card */}
          <div className="p-8 rounded-2xl bg-[#151512] border border-white/5 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-mono font-bold text-[#C9A45C]">
                    Order #{order.id}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    Network: {networkDisplayName}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-3 py-1 rounded-full bg-white/10 text-[#F5F2E8]">
                    Status: {order.status}
                  </span>
                  <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full ${
                    order.paymentStatus === 'Funded' || order.paymentStatus === 'Released'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    Escrow: {order.paymentStatus}
                  </span>
                </div>
                <h1 className="text-2xl font-bold text-[#F5F2E8] mt-2">{order.serviceTitle}</h1>
              </div>

              <div className="text-right">
                <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Agreed Escrow Value
                </span>
                <div className="text-2xl font-black text-[#F5F2E8]">
                  {order.priceSnapshot} <span className="text-sm text-[#C9A45C] font-mono">{order.currency}</span>
                </div>
              </div>
            </div>

            {/* Stepper */}
            <div className="pt-6 border-t border-white/5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { step: 1, label: '1. Order Created' },
                  { step: 2, label: '2. Escrow Funded' },
                  { step: 3, label: '3. Work In Review' },
                  { step: 4, label: '4. Funds Released' },
                ].map((s) => {
                  const completed = currentStep >= s.step;
                  return (
                    <div
                      key={s.step}
                      className={`p-3 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${
                        completed
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-[#0A0A09] border-white/5 text-[#A8A397]'
                      }`}
                    >
                      <CheckCircle2 className={`w-4 h-4 ${completed ? 'text-emerald-400' : 'text-white/20'}`} />
                      <span>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Left 2 Cols: Order Lifecycle Actions */}
            <div className="lg:col-span-2 space-y-6">
              {/* On-Chain Transaction Progress Feedback Banner */}
              {txStage !== 'idle' && (
                <div className={`p-5 rounded-2xl border transition-all ${
                  txStage === 'confirmed'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : txStage === 'failed'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-[#C9A45C]/10 border-[#C9A45C]/30 text-[#F5F2E8]'
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {txStage === 'confirmed' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : txStage === 'failed' ? (
                        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                      ) : (
                        <Loader2 className="w-5 h-5 text-[#C9A45C] animate-spin shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1">
                        <div className="text-xs font-bold uppercase tracking-wider">
                          {txStage === 'awaiting_wallet' && `Awaiting Wallet Approval (${txActionLabel})`}
                          {txStage === 'mining' && `Confirming On-Chain (${txActionLabel})`}
                          {txStage === 'verifying' && `Verifying On-Chain Proof (${txActionLabel})`}
                          {txStage === 'confirmed' && `Transaction Confirmed & Settled (${txActionLabel})`}
                          {txStage === 'failed' && `Transaction Notice (${txActionLabel})`}
                        </div>
                        <p className="text-xs text-[#A8A397]">
                          {txStage === 'awaiting_wallet' && 'Please confirm the transaction in your connected wallet (MetaMask or Rabby)...'}
                          {txStage === 'mining' && `Transaction broadcast to ${networkDisplayName}! Waiting for block confirmation...`}
                          {txStage === 'verifying' && 'Block confirmed! Verifying contract event logs and updating database...'}
                          {txStage === 'confirmed' && (txSuccessMessage || 'On-chain transaction confirmed and synchronized.')}
                          {txStage === 'failed' && (txErrorMessage || 'Transaction failed or was rejected.')}
                        </p>
                        {activeTxHash && (
                          <a
                            href={getTxExplorerUrl(activeTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-[#C9A45C] hover:underline font-mono pt-1"
                          >
                            <span>View Tx on {getExplorerName()}: {activeTxHash.slice(0, 10)}...{activeTxHash.slice(-8)}</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                    {(txStage === 'confirmed' || txStage === 'failed') && (
                      <button
                        onClick={() => { setTxStage('idle'); setTxErrorMessage(null); setTxSuccessMessage(null); }}
                        className="text-xs text-[#A8A397] hover:text-[#F5F2E8] px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 1 / Awaiting Payment Action */}
              {order.status === 'AwaitingPayment' && isBuyer && (
                <div className="p-6 rounded-2xl bg-[#151512] border border-amber-500/30 space-y-4">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                    <Coins className="w-4 h-4" />
                    <span>Action Required: Deposit Escrow Funds</span>
                  </div>
                  <p className="text-xs text-[#A8A397] leading-relaxed">
                    Deposit <strong>{order.priceSnapshot} {order.currency}</strong> into the on-chain escrow contract. Funds will remain safely locked until you inspect and approve the provider's deliverables.
                  </p>

                  <div className="pt-2">
                    <button
                      onClick={handleDepositEscrow}
                      disabled={depositing}
                      className="py-3 px-6 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                    >
                      {depositing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Processing On-Chain Deposit...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Deposit {order.priceSnapshot} {order.currency} into Escrow</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2 / Work In Progress (Seller Submission Action) */}
              {(order.status === 'InProgress' || order.status === 'RevisionRequested') && isSeller && (
                <div className="p-6 rounded-2xl bg-[#151512] border border-[#C9A45C]/30 space-y-4">
                  <div className="flex items-center gap-2 text-[#C9A45C] font-bold text-xs uppercase tracking-wider">
                    <Send className="w-4 h-4" />
                    <span>Provider Action: Submit Deliverables</span>
                  </div>
                  <p className="text-xs text-[#A8A397]">
                    Escrow is funded. Submit your completed deliverables, links, or documentation for the buyer to review.
                  </p>

                  <form onSubmit={handleSubmitDeliverables} className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                        Work Summary & Instructions *
                      </label>
                      <textarea
                        rows={3}
                        value={subDescription}
                        onChange={(e) => setSubDescription(e.target.value)}
                        placeholder="Detail the completed milestones, test results, and handover notes..."
                        required
                        className="w-full bg-[#0A0A09] border border-white/10 rounded-xl p-3 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                      ></textarea>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                        Deliverable Link / Artifact Reference
                      </label>
                      <input
                        type="text"
                        value={subDeliverableRef}
                        onChange={(e) => setSubDeliverableRef(e.target.value)}
                        placeholder="e.g. https://github.com/... or ipfs://Qm..."
                        className="w-full bg-[#0A0A09] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={submittingWork}
                        className="py-3 px-6 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                      >
                        {submittingWork ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Submitting...</span>
                          </>
                        ) : (
                          <span>Submit Work for Buyer Approval</span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleCancelOrder}
                        disabled={cancelling}
                        className="py-2.5 px-4 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold uppercase tracking-wider rounded-xl border border-rose-500/20 transition-colors flex items-center gap-1.5"
                      >
                        {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        <span>Cancel & Refund Buyer</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Buyer Timeout Refund Option (when deadline passes without submission) */}
              {isBuyer && Date.now() > order.deadline && (order.status === 'Funded' || order.status === 'InProgress') && (
                <div className="p-6 rounded-2xl bg-[#151512] border border-rose-500/30 space-y-3">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4" />
                    <span>Delivery Deadline Passed</span>
                  </div>
                  <p className="text-xs text-[#A8A397]">
                    The agreed delivery deadline ({new Date(order.deadline).toLocaleString()}) has passed without work deliverables. You may claim a full timeout refund from the escrow contract.
                  </p>
                  <button
                    onClick={handleCancelOrder}
                    disabled={cancelling}
                    className="py-2.5 px-5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    <span>Claim Full Timeout Refund</span>
                  </button>
                </div>
              )}

              {/* STEP 3 / Work In Review (Buyer Approval / Revision Action) */}
              {order.status === 'InReview' && isBuyer && (
                <div className="p-6 rounded-2xl bg-[#151512] border border-purple-500/30 space-y-4">
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-xs uppercase tracking-wider">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Buyer Review Action: Approve Deliverables or Request Revision</span>
                  </div>
                  <p className="text-xs text-[#A8A397]">
                    The provider has submitted their work. Please inspect the deliverables below. When satisfied, click Approve to release escrow funds to the seller.
                  </p>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={handleApproveWork}
                      disabled={approving}
                      className="py-3 px-6 bg-[#C9A45C] hover:bg-[#E6CC91] text-[#0A0A09] text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                    >
                      {approving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Releasing Funds...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approve & Release Funds to Seller</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setShowRevisionForm(!showRevisionForm)}
                      className="py-3 px-5 bg-white/5 hover:bg-white/10 text-[#F5F2E8] text-xs font-bold uppercase tracking-wider rounded-xl border border-white/10 transition-colors flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Request Revision</span>
                    </button>
                  </div>

                  {showRevisionForm && (
                    <form onSubmit={handleRequestRevision} className="pt-4 border-t border-white/5 space-y-3">
                      <label className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                        Revision Feedback for Provider *
                      </label>
                      <textarea
                        rows={3}
                        value={revisionFeedback}
                        onChange={(e) => setRevisionFeedback(e.target.value)}
                        placeholder="Explain what adjustments or additions are required before approval..."
                        required
                        className="w-full bg-[#0A0A09] border border-white/10 rounded-xl p-3 text-xs text-[#F5F2E8] focus:outline-none focus:border-[#C9A45C]"
                      ></textarea>
                      <button
                        type="submit"
                        disabled={requestingRevision}
                        className="py-2.5 px-5 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 text-xs font-bold uppercase tracking-wider rounded-xl border border-rose-500/30 transition-colors flex items-center gap-2"
                      >
                        {requestingRevision ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Submit Revision Request</span>}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Completed Notice */}
              {order.status === 'Completed' && (
                <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                      Order Successfully Completed & Settled
                    </h4>
                    <p className="text-xs text-[#A8A397]">
                      The buyer approved the deliverable and escrow settlement was executed on-chain.
                    </p>
                  </div>
                </div>
              )}

              {/* Cancelled Notice */}
              {order.status === 'Cancelled' && (
                <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-4">
                  <AlertCircle className="w-8 h-8 text-amber-400 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                      Order Cancelled & Refunded
                    </h4>
                    <p className="text-xs text-[#A8A397]">
                      This order was cancelled by mutual consent or provider action, and escrow funds have been returned to the buyer.
                    </p>
                  </div>
                </div>
              )}

              {/* Refunded Notice */}
              {order.status === 'Refunded' && (
                <div className="p-6 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-4">
                  <RotateCcw className="w-8 h-8 text-blue-400 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">
                      Escrow Funds Refunded
                    </h4>
                    <p className="text-xs text-[#A8A397]">
                      Escrow funds have been refunded to the buyer on-chain.
                    </p>
                  </div>
                </div>
              )}

              {/* Submissions & Deliverables History */}
              <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
                <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Work Submissions History ({submissions.length})
                </span>

                {submissions.length === 0 ? (
                  <p className="text-xs text-[#A8A397] italic">No work submissions uploaded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {submissions.map((sub, i) => (
                      <div key={sub.id} className="p-4 rounded-xl bg-[#0A0A09] border border-white/5 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-[#A8A397]">
                          <span className="font-bold text-[#F5F2E8]">Submission #{i + 1}</span>
                          <span>{new Date(sub.submittedAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-[#F5F2E8] leading-relaxed">{sub.description}</p>
                        {sub.deliverableReferences && sub.deliverableReferences.length > 0 && (
                          <div className="pt-2 flex flex-wrap gap-2">
                            {sub.deliverableReferences.map((ref, idx) => (
                              <a
                                key={idx}
                                href={ref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/5 hover:bg-white/10 text-xs font-mono text-[#C9A45C] rounded-lg border border-white/5"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Artifact: {ref.length > 35 ? ref.slice(0, 35) + '...' : ref}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Revision Requests History */}
              {revisions.length > 0 && (
                <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
                  <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                    Revision Requests ({revisions.length})
                  </span>
                  <div className="space-y-3">
                    {revisions.map((rev, i) => (
                      <div key={rev.id} className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-rose-400">
                          <span className="font-bold">Revision #{i + 1}</span>
                          <span>{new Date(rev.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-[#F5F2E8]">{rev.feedback}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dispute Resolution Panel */}
              <DisputeResolutionPanel
                order={order}
                dispute={dispute}
                currentUserAddress={(isSolanaOrder ? solanaAddress : address) || undefined}
                network={order.network}
                sendSolanaInstruction={isSolanaOrder ? sendSolanaTx : undefined}
                onRefresh={fetchOrderData}
              />
            </div>

            {/* Right Col: Order Snapshot & Contract Escrow Info */}
            <div className="space-y-6">
              {/* Connected Wallet & Network Status Card */}
              <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                    Connected Wallet & Escrow
                  </span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    chainId === expectedChainId ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${chainId === expectedChainId ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                    {chainId === 97 ? 'BNB Testnet (97)' : chainId === 84532 ? 'Base Sepolia (84532)' : `Chain ${chainId || 'Unknown'}`}
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-[10px] text-[#A8A397] block">Your Wallet Address</span>
                    <p className="text-[#F5F2E8] font-mono mt-0.5 truncate" title={address || ''}>
                      {address || 'Not connected'}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] text-[#A8A397]">Wallet Balance</span>
                    <span className="text-[#C9A45C] font-mono font-bold">
                      {balanceData ? `${parseFloat(formatEther(balanceData.value)).toFixed(4)} ${balanceData.symbol}` : `0.0000 ${currencyLabel}`}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[10px] text-[#A8A397] block">Escrow Contract ({networkDisplayName})</span>
                    <a
                      href={getAddressExplorerUrl(targetEscrowAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#C9A45C] font-mono text-[11px] hover:underline flex items-center gap-1 mt-0.5 truncate"
                    >
                      <span>{targetEscrowAddress.slice(0, 10)}...{targetEscrowAddress.slice(-8)}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>

                  {order.escrowTxHash && (
                    <div className="pt-2 border-t border-white/5">
                      <span className="text-[10px] text-[#A8A397] block">On-Chain Escrow Tx</span>
                      <a
                        href={getTxExplorerUrl(order.escrowTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 font-mono text-[11px] hover:underline flex items-center gap-1 mt-0.5 truncate"
                      >
                        <span>{order.escrowTxHash.slice(0, 10)}...{order.escrowTxHash.slice(-8)}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-4">
                <span className="text-[10px] uppercase tracking-widest text-[#A8A397] block font-bold">
                  Immutable Terms Snapshot
                </span>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-[10px] text-[#A8A397] block">Agreed Scope</span>
                    <p className="text-[#F5F2E8] mt-0.5">{order.scopeSnapshot}</p>
                  </div>

                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[10px] text-[#A8A397] block">Delivery Deadline</span>
                    <p className="text-[#F5F2E8] font-mono mt-0.5">
                      {new Date(order.deadline).toLocaleString()}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[10px] text-[#A8A397] block">Buyer Wallet</span>
                    <p className="text-[#F5F2E8] font-mono truncate">{order.buyerId}</p>
                  </div>

                  <div className="pt-2 border-t border-white/5">
                    <span className="text-[10px] text-[#A8A397] block">Provider Wallet</span>
                    <p className="text-[#F5F2E8] font-mono truncate">{order.sellerId}</p>
                  </div>

                  {order.escrowTxHash && (
                    <div className="pt-2 border-t border-white/5">
                      <span className="text-[10px] text-[#A8A397] block">Escrow Deposit Tx</span>
                      <p className="text-[#C9A45C] font-mono truncate">{order.escrowTxHash}</p>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-white/5">
                  <Link
                    href={`/services/messages?conversationId=${order.conversationId}`}
                    className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 text-[#F5F2E8] text-xs font-bold uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2 border border-white/10"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#C9A45C]" />
                    <span>Open Order Chat</span>
                  </Link>
                </div>
              </div>

              {/* Escrow Contract Security Information */}
              <div className="p-6 rounded-2xl bg-[#151512] border border-white/5 space-y-3 text-xs text-[#A8A397]">
                <div className="flex items-center gap-2 text-[#F5F2E8] font-bold">
                  <Lock className="w-4 h-4 text-[#C9A45C]" />
                  <span>Smart Contract Security</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Escrow Contract ({networkDisplayName}): <code className="text-[#C9A45C] font-mono">{targetEscrowAddress.slice(0, 10)}...{targetEscrowAddress.slice(-8)}</code>
                </p>
                <p className="text-[11px] leading-relaxed">
                  Only the buyer can approve and trigger fund release. If a dispute arises or deadline passes without submission, the protocol supports mutual cancellation and designated reviewer resolution.
                </p>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}
