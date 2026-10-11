import VeilServiceEscrowArtifact from './abi/VeilServiceEscrow.json';
import VeilServiceRegistryArtifact from './abi/VeilServiceRegistry.json';
import { VEILIO_SERVICES_CONTRACT_ADDRESS } from './agent-sdk';

export const VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS = VEILIO_SERVICES_CONTRACT_ADDRESS;
export const VEIL_SERVICE_ESCROW_ABI = VeilServiceEscrowArtifact.abi;

export const VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS ||
  process.env.SERVICE_REGISTRY_CONTRACT_ADDRESS ||
  '0x016A23A069180587d5D8B09413e97E1e78ccD702'
) as `0x${string}`;


export const VEIL_SERVICE_REGISTRY_ABI = VeilServiceRegistryArtifact.abi;
