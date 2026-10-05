'use client';

import React, { useState, useRef } from 'react';
import Image from 'next/image';
import { uploadImageToIpfs, IpfsUploadResponse } from '@/lib/ipfs';

interface ImageUploaderProps {
  onUploadSuccess: (uploadData: IpfsUploadResponse) => void;
  onImageRemoved: () => void;
}

export default function ImageUploader({ onUploadSuccess, onImageRemoved }: ImageUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<IpfsUploadResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const imageIsOnIpfs = uploadResult?.uri.startsWith('ipfs://') ?? false;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    setErrorMsg(null);

    // Validate type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setErrorMsg('Please upload a JPG, PNG, or WebP image.');
      return;
    }

    // Validate size max 5MB
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image must be smaller than 5 MB.');
      return;
    }

    setSelectedFile(file);
    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);

    // Start IPFS upload
    try {
      setIsUploading(true);
      const res = await uploadImageToIpfs(file);
      setUploadResult(res);
      onUploadSuccess(res);
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMsg(err.message || 'Image upload to IPFS failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleRemove = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadResult(null);
    setErrorMsg(null);
    onImageRemoved();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs uppercase font-bold text-[#A8A397]">
        PRODUCT COVER IMAGE
      </label>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          {errorMsg}
        </div>
      )}

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
          }
        }}
        className="hidden"
      />

      {/* STATE A: EMPTY */}
      {!previewUrl && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`cursor-pointer flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all duration-200 text-center space-y-3 bg-[#0A0A09] ${
            isDragging
              ? 'border-[#C9A45C] bg-[#C9A45C]/5'
              : 'border-white/10 hover:border-[#C9A45C]/50 hover:bg-white/[0.02]'
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-[#C9A45C] text-xl font-bold">
            +
          </div>
          <div>
            <span className="font-bold text-[#F5F2E8] text-sm block">Upload an image</span>
            <span className="text-xs text-[#A8A397] mt-1 block">
              JPG, PNG or WebP · Max 5 MB
            </span>
          </div>
        </div>
      )}

      {/* STATE B/C/D: SELECTED / UPLOADING / UPLOADED */}
      {previewUrl && (
        <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-[#0A0A09] p-4 space-y-4">
          <div className="flex gap-4 items-center">
            {/* Thumbnail Preview */}
            <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-[#151512] border border-white/10 flex-shrink-0">
              <Image
                src={previewUrl}
              alt="Product Cover Preview"
                fill
                className="object-cover object-center"
              />
            </div>

            {/* Status Information */}
            <div className="flex-grow space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#F5F2E8] truncate max-w-[200px]">
                  {selectedFile?.name}
                </span>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={isUploading}
                  className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors"
                >
                  Remove
                </button>
              </div>

              {/* UPLOADING STATE */}
              {isUploading && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-[#C9A45C]">
                    <div className="w-3 h-3 rounded-full border-2 border-[#C9A45C] border-t-transparent animate-spin" />
                    <span>Uploading cover image...</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-[#C9A45C] h-full animate-pulse w-3/4" />
                  </div>
                </div>
              )}

              {/* UPLOADED STATE */}
              {uploadResult && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#C9A45C]">
                    <span>✓ {imageIsOnIpfs ? 'Image pinned to IPFS' : 'Cover saved on this server'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-[#A8A397] break-all">
                    CID: <span className="text-[#F5F2E8]">{uploadResult.cid}</span>
                  </div>
                  <a
                    href={uploadResult.gatewayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-[11px] font-semibold text-[#C9A45C] hover:underline"
                  >
                    {imageIsOnIpfs ? 'View on IPFS Gateway' : 'Preview saved cover'} &rarr;
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
