return (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    {/* Tool header */}
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
      <div>
        <div className="text-sm font-semibold">
          MP4 metadata
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          60 / 120 FPS timing patch
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Local
      </div>
    </div>

    {/* Main tool area */}
    <div className="p-5 sm:p-6">
      {!file ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative flex min-h-[300px] flex-col items-center justify-center
            rounded-lg border border-dashed
            px-6 py-12 text-center transition-colors
            ${
              isDragging
                ? "border-foreground bg-muted"
                : "border-border hover:border-foreground/30"
            }
          `}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background text-xs font-semibold">
            MP4
          </div>

          <h2 className="mt-5 text-sm font-medium">
            Drop your MP4 here
          </h2>

          <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
            60 or 120 FPS MP4 files are supported.
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Choose MP4
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,.mp4"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* Selected file */}
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[10px] font-semibold">
                MP4
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {file.name}
                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                  {detectedFps
                    ? ` · ${detectedFps} FPS`
                    : ""}
                  {duration
                    ? ` · ${formatDuration(duration)}`
                    : ""}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={clearFile}
              className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground sm:self-auto"
            >
              Remove
            </button>
          </div>

          <div className="border-t border-border" />

          {/* Status / action */}
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    error
                      ? "bg-red-500"
                      : status === "success"
                        ? "bg-emerald-500"
                        : "bg-foreground"
                  }`}
                />

                {statusText}
              </div>

              {error ? (
                <p className="mt-1 text-xs text-red-500">
                  {error}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  The original video and audio streams are not re-encoded.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={handlePatch}
              disabled={isProcessing}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isProcessing ? "Patching…" : "Patch MP4"}
            </button>
          </div>
        </div>
      )}
    </div>
  </div>
);
