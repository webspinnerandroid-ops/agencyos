export default function PendingApprovalPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4 max-w-md px-6">
        <h1 className="text-2xl font-semibold text-gray-800">Pending Approval</h1>
        <p className="text-gray-600">
          Your account has been created but has not yet been assigned to a
          tenant. Please contact your agency administrator to complete your
          account setup.
        </p>
        <a
          href="/login"
          className="inline-block text-blue-600 hover:text-blue-800 underline"
        >
          Return to sign in
        </a>
      </div>
    </div>
  );
}