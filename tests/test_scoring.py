from scoring.engine import invert_rank, percentile_ranks, weighted_score


def test_percentile_ranks_order():
    ranks = percentile_ranks([10, 20, 30, None])
    assert ranks[0] == 0
    assert ranks[2] == 100
    assert ranks[3] is None


def test_weighted_score_skips_missing():
    score, meta = weighted_score({"a": 100, "b": None}, {"a": 0.5, "b": 0.5})
    assert score == 100
    assert meta["missingFactors"] == ["b"]


def test_invert_rank():
    assert invert_rank(20) == 80
    assert invert_rank(None) is None
