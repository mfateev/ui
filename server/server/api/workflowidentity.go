package api

import (
	"context"
	"net/http"
	"net/url"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/api/workflowservice/v1"
	"google.golang.org/grpc"
)

const WorkflowLatestExecutionURL = "/api/v1/namespaces/{namespace}/workflows/{workflow}/latest-execution"

const describeWorkflowExecutionMethod = "/temporal.api.workflowservice.v1.WorkflowService/DescribeWorkflowExecution"

type WorkflowExecutionIdentityResponse struct {
	WorkflowID          string `json:"workflowId"`
	RunID               string `json:"runId"`
	FirstExecutionRunID string `json:"firstExecutionRunId"`
}

type IWorkflowIdentityService interface {
	DescribeWorkflowExecution(
		ctx context.Context,
		in *workflowservice.DescribeWorkflowExecutionRequest,
		opts ...grpc.CallOption,
	) (*workflowservice.DescribeWorkflowExecutionResponse, error)
	GetWorkflowExecutionHistory(
		ctx context.Context,
		in *workflowservice.GetWorkflowExecutionHistoryRequest,
		opts ...grpc.CallOption,
	) (*workflowservice.GetWorkflowExecutionHistoryResponse, error)
}

func RegisterWorkflowExecutionIdentityHandler(mux *runtime.ServeMux, service IWorkflowIdentityService) error {
	return mux.HandlePath(http.MethodGet, WorkflowLatestExecutionURL, func(w http.ResponseWriter, r *http.Request, pathParams map[string]string) {
		_, outboundMarshaler := runtime.MarshalerForRequest(mux, r)
		ctx, err := runtime.AnnotateContext(
			r.Context(),
			mux,
			r,
			describeWorkflowExecutionMethod,
			runtime.WithHTTPPathPattern(WorkflowLatestExecutionURL),
		)
		if err != nil {
			runtime.HTTPError(r.Context(), mux, outboundMarshaler, w, r, err)
			return
		}

		workflowID, err := url.PathUnescape(pathParams["workflow"])
		if err != nil {
			runtime.HTTPError(ctx, mux, outboundMarshaler, w, r, serviceerror.NewInvalidArgument("workflow ID is not valid URL encoding"))
			return
		}

		response, err := ResolveLatestWorkflowExecutionIdentity(ctx, service, pathParams["namespace"], workflowID)
		if err != nil {
			runtime.HTTPError(ctx, mux, outboundMarshaler, w, r, err)
			return
		}

		w.Header().Set("Content-Type", outboundMarshaler.ContentType(response))
		if err := outboundMarshaler.NewEncoder(w).Encode(response); err != nil {
			runtime.HTTPError(ctx, mux, outboundMarshaler, w, r, err)
		}
	})
}

func ResolveLatestWorkflowExecutionIdentity(
	ctx context.Context,
	service IWorkflowIdentityService,
	namespace string,
	workflowID string,
) (*WorkflowExecutionIdentityResponse, error) {
	describeResponse, err := service.DescribeWorkflowExecution(ctx, &workflowservice.DescribeWorkflowExecutionRequest{
		Namespace: namespace,
		Execution: &common.WorkflowExecution{WorkflowId: workflowID},
	})
	if err != nil {
		return nil, err
	}

	info := describeResponse.GetWorkflowExecutionInfo()
	execution := info.GetExecution()
	resolvedWorkflowID := execution.GetWorkflowId()
	runID := execution.GetRunId()
	if resolvedWorkflowID == "" || runID == "" {
		return nil, serviceerror.NewFailedPrecondition("Temporal returned an incomplete latest workflow execution identity")
	}

	firstExecutionRunID := info.GetFirstRunId()
	if firstExecutionRunID == "" {
		historyResponse, err := service.GetWorkflowExecutionHistory(ctx, &workflowservice.GetWorkflowExecutionHistoryRequest{
			Namespace:       namespace,
			Execution:       &common.WorkflowExecution{WorkflowId: resolvedWorkflowID, RunId: runID},
			MaximumPageSize: 1,
		})
		if err != nil {
			return nil, err
		}

		events := historyResponse.GetHistory().GetEvents()
		if len(events) != 1 || events[0].GetEventType() != enums.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED {
			return nil, serviceerror.NewFailedPrecondition("Temporal did not return the workflow start event")
		}

		firstExecutionRunID = events[0].GetWorkflowExecutionStartedEventAttributes().GetFirstExecutionRunId()
		if firstExecutionRunID == "" {
			return nil, serviceerror.NewFailedPrecondition("workflow start event does not identify its execution chain")
		}
	}

	return &WorkflowExecutionIdentityResponse{
		WorkflowID:          resolvedWorkflowID,
		RunID:               runID,
		FirstExecutionRunID: firstExecutionRunID,
	}, nil
}
