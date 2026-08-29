package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/api/common/v1"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/history/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/api/workflow/v1"
	"go.temporal.io/api/workflowservice/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type workflowIdentityService struct {
	describe func(context.Context, *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error)
	history  func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error)
}

func (s workflowIdentityService) DescribeWorkflowExecution(
	ctx context.Context,
	request *workflowservice.DescribeWorkflowExecutionRequest,
	_ ...grpc.CallOption,
) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
	return s.describe(ctx, request)
}

func (s workflowIdentityService) GetWorkflowExecutionHistory(
	ctx context.Context,
	request *workflowservice.GetWorkflowExecutionHistoryRequest,
	_ ...grpc.CallOption,
) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
	return s.history(ctx, request)
}

func describeIdentity(workflowID, runID, firstRunID string) *workflowservice.DescribeWorkflowExecutionResponse {
	return &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflow.WorkflowExecutionInfo{
			Execution:  &common.WorkflowExecution{WorkflowId: workflowID, RunId: runID},
			FirstRunId: firstRunID,
		},
	}
}

func startedHistory(firstRunID string) *workflowservice.GetWorkflowExecutionHistoryResponse {
	return &workflowservice.GetWorkflowExecutionHistoryResponse{
		History: &history.History{Events: []*history.HistoryEvent{{
			EventId:   1,
			EventType: enums.EVENT_TYPE_WORKFLOW_EXECUTION_STARTED,
			Attributes: &history.HistoryEvent_WorkflowExecutionStartedEventAttributes{
				WorkflowExecutionStartedEventAttributes: &history.WorkflowExecutionStartedEventAttributes{
					FirstExecutionRunId: firstRunID,
				},
			},
		}}},
	}
}

func TestResolveLatestWorkflowExecutionIdentityUsesDescribeFirstRunID(t *testing.T) {
	service := workflowIdentityService{
		describe: func(_ context.Context, request *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
			assert.Equal(t, "test-namespace", request.Namespace)
			assert.Equal(t, "test-workflow", request.Execution.WorkflowId)
			assert.Empty(t, request.Execution.RunId)
			return describeIdentity("test-workflow", "latest-run", "first-run"), nil
		},
		history: func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
			t.Fatal("history should not be requested when Describe returns firstRunId")
			return nil, nil
		},
	}

	identity, err := ResolveLatestWorkflowExecutionIdentity(context.Background(), service, "test-namespace", "test-workflow")

	require.NoError(t, err)
	assert.Equal(t, &WorkflowExecutionIdentityResponse{
		WorkflowID:          "test-workflow",
		RunID:               "latest-run",
		FirstExecutionRunID: "first-run",
	}, identity)
}

func TestResolveLatestWorkflowExecutionIdentityFallsBackToOnePinnedHistoryPage(t *testing.T) {
	service := workflowIdentityService{
		describe: func(_ context.Context, _ *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
			return describeIdentity("test-workflow", "latest-run", ""), nil
		},
		history: func(_ context.Context, request *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
			assert.Equal(t, "test-namespace", request.Namespace)
			assert.Equal(t, "test-workflow", request.Execution.WorkflowId)
			assert.Equal(t, "latest-run", request.Execution.RunId)
			assert.EqualValues(t, 1, request.MaximumPageSize)
			assert.False(t, request.WaitNewEvent)
			assert.Empty(t, request.NextPageToken)
			return startedHistory("first-run"), nil
		},
	}

	identity, err := ResolveLatestWorkflowExecutionIdentity(context.Background(), service, "test-namespace", "test-workflow")

	require.NoError(t, err)
	assert.Equal(t, "latest-run", identity.RunID)
	assert.Equal(t, "first-run", identity.FirstExecutionRunID)
}

func TestResolveLatestWorkflowExecutionIdentityPropagatesTemporalErrors(t *testing.T) {
	describeError := serviceerror.NewNotFound("workflow does not exist")
	service := workflowIdentityService{
		describe: func(context.Context, *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
			return nil, describeError
		},
		history: func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
			t.Fatal("history should not be requested after a Describe error")
			return nil, nil
		},
	}

	_, err := ResolveLatestWorkflowExecutionIdentity(context.Background(), service, "test-namespace", "test-workflow")

	assert.ErrorIs(t, err, describeError)
}

func TestResolveLatestWorkflowExecutionIdentityRejectsMalformedResponses(t *testing.T) {
	tests := map[string]struct {
		describe *workflowservice.DescribeWorkflowExecutionResponse
		history  *workflowservice.GetWorkflowExecutionHistoryResponse
	}{
		"missing resolved identity": {
			describe: &workflowservice.DescribeWorkflowExecutionResponse{},
		},
		"missing start event": {
			describe: describeIdentity("test-workflow", "latest-run", ""),
			history:  &workflowservice.GetWorkflowExecutionHistoryResponse{},
		},
		"wrong first event": {
			describe: describeIdentity("test-workflow", "latest-run", ""),
			history: &workflowservice.GetWorkflowExecutionHistoryResponse{
				History: &history.History{Events: []*history.HistoryEvent{{EventType: enums.EVENT_TYPE_WORKFLOW_TASK_STARTED}}},
			},
		},
		"missing chain identity": {
			describe: describeIdentity("test-workflow", "latest-run", ""),
			history:  startedHistory(""),
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			service := workflowIdentityService{
				describe: func(context.Context, *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
					return test.describe, nil
				},
				history: func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
					return test.history, nil
				},
			}

			_, err := ResolveLatestWorkflowExecutionIdentity(context.Background(), service, "test-namespace", "test-workflow")

			var failedPrecondition *serviceerror.FailedPrecondition
			assert.ErrorAs(t, err, &failedPrecondition)
		})
	}
}

func TestResolveLatestWorkflowExecutionIdentityPropagatesHistoryError(t *testing.T) {
	historyError := errors.New("history unavailable")
	service := workflowIdentityService{
		describe: func(context.Context, *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
			return describeIdentity("test-workflow", "latest-run", ""), nil
		},
		history: func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
			return nil, historyError
		},
	}

	_, err := ResolveLatestWorkflowExecutionIdentity(context.Background(), service, "test-namespace", "test-workflow")

	assert.ErrorIs(t, err, historyError)
}

func TestWorkflowExecutionIdentityHandlerForwardsMetadataAndDecodesWorkflowID(t *testing.T) {
	service := workflowIdentityService{
		describe: func(ctx context.Context, request *workflowservice.DescribeWorkflowExecutionRequest) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
			md, ok := metadata.FromOutgoingContext(ctx)
			require.True(t, ok)
			assert.Contains(t, md.Get("authorization"), "Bearer test-token")
			assert.Equal(t, "test/workflow+id", request.Execution.WorkflowId)
			return describeIdentity(request.Execution.WorkflowId, "latest-run", "first-run"), nil
		},
		history: func(context.Context, *workflowservice.GetWorkflowExecutionHistoryRequest) (*workflowservice.GetWorkflowExecutionHistoryResponse, error) {
			t.Fatal("history should not be requested")
			return nil, nil
		},
	}
	mux := runtime.NewServeMux(
		withMarshaler(),
		runtime.WithMetadata(func(_ context.Context, request *http.Request) metadata.MD {
			return metadata.Pairs("authorization", request.Header.Get("Authorization"))
		}),
		runtime.WithErrorHandler(errorHandler),
		runtime.WithUnescapingMode(runtime.UnescapingModeAllExceptReserved),
	)
	require.NoError(t, RegisterWorkflowExecutionIdentityHandler(mux, service))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/namespaces/test-namespace/workflows/test%2Fworkflow+id/latest-execution", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	recorder := httptest.NewRecorder()

	mux.ServeHTTP(recorder, req)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{
		"workflowId": "test/workflow+id",
		"runId": "latest-run",
		"firstExecutionRunId": "first-run"
	}`, recorder.Body.String())
}
