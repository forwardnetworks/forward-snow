(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  try {
    var requiredRole = "__SCOPE__.evidence_writer";
    if (!gs.hasRole("admin") && !gs.hasRole(requiredRole)) {
      response.setStatus(403);
      return { status: "error", message: "change assurance writer role is required" };
    }

    var pathParams = request.pathParams || {};
    var changeSysId = String(pathParams.change_sys_id || "");
    var payload = request.body && request.body.dataString;
    if (!payload && request.body) payload = request.body.data;
    if (!payload) {
      response.setStatus(400);
      return { status: "error", message: "JSON assurance evidence body is required" };
    }
    var evidenceSha256 = String(request.getHeader("X-Forward-Dynatrace-SHA256") || "");
    if (!/^[a-f0-9]{64}$/.test(evidenceSha256)) {
      response.setStatus(400);
      return { status: "error", message: "X-Forward-Dynatrace-SHA256 header is required" };
    }

    var result = new ChangeAssuranceService().ingest(changeSysId, payload, evidenceSha256);
    response.setStatus(200);
    return { status: "ok", assurance: result };
  } catch (e) {
    var requestedStatus = e && Number(e.statusCode);
    var status = [400, 404, 409].indexOf(requestedStatus) >= 0 ? requestedStatus : 500;
    var message = status === 500
      ? "change assurance ingestion failed"
      : (e && e.message ? String(e.message) : "change assurance request failed");
    if (message.length > 500) message = message.substring(0, 500);
    response.setStatus(status);
    return { status: "error", message: message };
  }
})(request, response);
